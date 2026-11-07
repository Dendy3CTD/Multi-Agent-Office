import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { redactSecrets } from "@open-agent-office/shared";
import {
  CodexBackendFailure,
  type CodexBackend,
  type CodexBackendCallbacks,
  type CodexBackendRun,
  type CodexBackendTask,
  type CodexFailureKind,
  type CodexNativeEvent,
  type CodexNativeUsage,
} from "./backend.js";

export type CodexSpawn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface ProductionCodexBackendOptions {
  readonly command?: string;
  /** The current official SDK uses --experimental-json; --json is injectable for a verified CLI revision. */
  readonly structuredOutputFlag?: "--experimental-json" | "--json";
  /** Empty by default: the backend must never invent model coverage. */
  readonly supportedModels: readonly string[];
  readonly provider?: string;
  readonly version?: string;
  readonly authenticated?: boolean;
  readonly available?: boolean;
  readonly allowedCwdRoots?: readonly string[];
  readonly maxOutputBytes?: number;
  readonly terminateGraceMs?: number;
  readonly timeoutMs?: number;
  readonly spawn?: CodexSpawn;
}

const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024;
const DEFAULT_GRACE = 1_500;
const DEFAULT_TIMEOUT = 10 * 60 * 1_000;
const emptyUsage = (): CodexNativeUsage => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 });
const finite = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;

function usageFrom(event: Record<string, unknown>): CodexNativeUsage | undefined {
  const usage = record(event.usage) ?? record(record(event.turn)?.usage) ?? record(event.tokens);
  if (!usage) return undefined;
  const input = finite(usage.input_tokens) ?? finite(usage.input) ?? 0;
  const output = finite(usage.output_tokens) ?? finite(usage.output) ?? 0;
  const reasoning = finite(usage.reasoning_tokens) ?? finite(usage.reasoning) ?? 0;
  const cacheRead = finite(usage.cached_input_tokens) ?? finite(usage.cache_read_input_tokens) ?? finite(usage.cacheRead) ?? 0;
  const cacheWrite = finite(usage.cache_write) ?? finite(usage.cacheWrite) ?? 0;
  const total = finite(usage.total_tokens) ?? finite(usage.total) ?? input + output + reasoning;
  const cost = finite(usage.cost_usd) ?? finite(usage.cost) ?? 0;
  return { input, output, reasoning, cacheRead, cacheWrite, total, cost };
}

function textFrom(event: Record<string, unknown>): string {
  const item = record(event.item);
  const candidates = [event.text, item?.text, record(event.message)?.text, record(item?.content)?.text];
  return candidates.find((value): value is string => typeof value === "string") ?? "";
}

function cwdAllowed(cwd: string, roots: readonly string[]): boolean {
  if (!isAbsolute(cwd) || roots.length === 0) return false;
  try {
    const target = realpathSync(cwd);
    return roots.some(root => {
      const base = realpathSync(root);
      const rest = relative(base, target);
      return rest === "" || (!rest.startsWith("..") && !isAbsolute(rest));
    });
  } catch {
    return false;
  }
}

/**
 * Production transport for the official Codex CLI.
 *
 * It deliberately does not discover or manufacture auth. `authenticated` and
 * `available` are caller-provided verified snapshots; this class never runs a
 * generation probe. Tests inject `spawn`, while production uses node spawn.
 */
export class ProductionCodexBackend implements CodexBackend {
  readonly kind = "real" as const;
  readonly id = "codex-cli";
  private readonly options: Required<Pick<ProductionCodexBackendOptions, "command" | "structuredOutputFlag" | "maxOutputBytes" | "terminateGraceMs" | "timeoutMs">> & ProductionCodexBackendOptions;
  private readonly active = new Map<string, { kill: () => void }>();

  constructor(options: ProductionCodexBackendOptions) {
    this.options = {
      command: "codex", structuredOutputFlag: "--experimental-json", maxOutputBytes: DEFAULT_MAX_OUTPUT,
      terminateGraceMs: DEFAULT_GRACE, timeoutMs: DEFAULT_TIMEOUT, ...options,
    };
    if (this.options.supportedModels.some(model => !model.trim() || model === "*")) throw new TypeError("Production Codex models must be explicit non-wildcard ids");
  }

  capabilities() {
    return Object.freeze({
      runtimeId: "codex" as const,
      runtimeType: "codex" as const,
      supportedProviders: Object.freeze([this.options.provider ?? "chatgpt-plus"]),
      supportedModels: Object.freeze([...this.options.supportedModels]),
      session: false,
      cancel: true,
      streamEvents: true,
      usage: true,
      notes: Object.freeze([
        "official Codex CLI transport; no credentials are read or generated by MAO",
        `cli=${this.options.command} structured-output=${this.options.structuredOutputFlag}`,
        this.options.version ? `version=${redactSecrets(this.options.version)}` : "version=unverified",
        this.options.authenticated === true ? "authentication=verified-by-caller" : "authentication=unverified",
        this.options.available === true ? "availability=verified-by-caller" : "availability=unverified",
      ]),
    });
  }

  execute(task: CodexBackendTask, callbacks: CodexBackendCallbacks): CodexBackendRun {
    if (!task.executionId || !task.modelId || !task.prompt.trim()) throw new CodexBackendFailure("config", "executionId, modelId and prompt are required");
    if (!this.options.supportedModels.includes(task.modelId)) throw new CodexBackendFailure("model", "Codex model is not confirmed by the runtime catalog");
    if (this.options.available !== true || this.options.authenticated !== true) throw new CodexBackendFailure("config", "Codex CLI availability and authentication are not verified");
    if (!cwdAllowed(task.cwd, this.options.allowedCwdRoots ?? [])) throw new CodexBackendFailure("config", "task cwd is outside the explicitly allowed Codex workspace");
    if (task.signal?.aborted) throw new CodexBackendFailure("abort", "Codex task was aborted before spawn");
    if (this.active.has(task.executionId)) throw new CodexBackendFailure("config", "Codex execution id is already active");

    const args = ["exec", this.options.structuredOutputFlag, "--sandbox", "read-only", "--cd", resolve(task.cwd), "--model", task.modelId, task.prompt];
    const spawn = this.options.spawn ?? ((command: string, argv: readonly string[], spawnOptions: SpawnOptions) => nodeSpawn(command, argv, spawnOptions));
    let child: ChildProcess;
    try { child = spawn(this.options.command, args, { cwd: resolve(task.cwd), shell: false, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (cause) { throw new CodexBackendFailure("config", "Unable to launch Codex CLI", { cause }); }
    if (!child.stdout || !child.stderr) { try { child.kill("SIGKILL"); } catch { /* best effort */ } throw new CodexBackendFailure("config", "Codex CLI pipes were not created"); }

    let settled = false;
    let stdout = "";
    let stderr = "";
    let remainder = "";
    let records: CodexNativeEvent[] = [];
    let usage = emptyUsage();
    let finalText = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    let terminating = false;
    let pendingFailure: { readonly kind: "abort" | "timeout" | "protocol"; readonly message: string } | undefined;
    let resolveCompletion!: (value: Awaited<CodexBackendRun["completion"]>) => void;
    let rejectCompletion!: (reason: unknown) => void;
    const completion = new Promise<Awaited<CodexBackendRun["completion"]>>((resolvePromise, rejectPromise) => { resolveCompletion = resolvePromise; rejectCompletion = rejectPromise; });
    const fail = (kind: CodexFailureKind, message: string, cause?: unknown) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); if (killTimer) clearTimeout(killTimer); if (abortListener) task.signal?.removeEventListener("abort", abortListener); this.active.delete(task.executionId); rejectCompletion(new CodexBackendFailure(kind, redactSecrets(message), { cause })); };
    const stop = (kind: "abort" | "timeout" | "protocol", message: string) => { if (settled || terminating) return; terminating = true; pendingFailure = { kind, message }; if (timer) clearTimeout(timer); if (abortListener) task.signal?.removeEventListener("abort", abortListener); try { child.kill("SIGTERM"); } catch { /* best effort */ } killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* best effort */ } }, this.options.terminateGraceMs); };
    const deliver = (event: Record<string, unknown>) => { if (settled) return; records.push(Object.freeze({ ...event })); const delta = usageFrom(event); if (delta) { usage = delta; try { callbacks.onUsage?.(delta, event); } catch (cause) { fail("callback", "Codex usage callback failed", cause); return; } } const text = textFrom(event); if (text) finalText += text; try { callbacks.onEvent?.(event); } catch (cause) { fail("callback", "Codex event callback failed", cause); } };
    const line = (value: string) => { const trimmed = value.trim(); if (!trimmed) return; let parsed: unknown; try { parsed = JSON.parse(trimmed); } catch (cause) { fail("protocol", "Codex CLI emitted malformed structured output", cause); return; } const event = record(parsed); if (!event) { fail("protocol", "Codex CLI emitted a non-object structured event"); return; } deliver(event); };
    const consume = (chunk: Buffer | string) => { if (settled || terminating) return; stdout += chunk.toString(); if (Buffer.byteLength(stdout) > this.options.maxOutputBytes) { stop("protocol", "Codex CLI output exceeded the configured limit"); return; } remainder += chunk.toString(); let index = remainder.indexOf("\n"); while (index >= 0 && !settled && !terminating) { line(remainder.slice(0, index).replace(/\r$/, "")); remainder = remainder.slice(index + 1); index = remainder.indexOf("\n"); } };
    child.stdout.on("data", consume);
    child.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); if (Buffer.byteLength(stderr) > this.options.maxOutputBytes) stderr = stderr.slice(-this.options.maxOutputBytes); });
    child.once("error", error => { if (!settled) fail("config", `Codex CLI process error: ${error.message}`, error); });
    child.once("close", code => { if (settled) return; if (pendingFailure) return fail(pendingFailure.kind, pendingFailure.message); if (remainder.trim()) line(remainder); if (settled) return; if (code !== 0) return fail("exit", `Codex CLI exited with code ${code ?? "unknown"}`); if (!finalText && records.length === 0) return fail("unknown", "Codex CLI returned no structured result"); settled = true; if (timer) clearTimeout(timer); this.active.delete(task.executionId); resolveCompletion({ text: finalText, records, exitCode: code ?? 0, reason: "stop", usage }); });
    abortListener = () => stop("abort", "Codex task was aborted"); task.signal?.addEventListener("abort", abortListener, { once: true });
    timer = setTimeout(() => stop("timeout", `Codex task exceeded ${task.timeoutMs ?? this.options.timeoutMs}ms`), task.timeoutMs ?? this.options.timeoutMs);
    const run: CodexBackendRun = { executionId: task.executionId, completion: completion.finally(() => { if (timer) clearTimeout(timer); if (killTimer) clearTimeout(killTimer); }) };
    this.active.set(task.executionId, { kill: () => stop("abort", "Codex task was cancelled") });
    return run;
  }

  cancel(executionId: string): void { const active = this.active.get(executionId); if (!active) throw new CodexBackendFailure("config", "Codex execution is not active"); active.kill(); }
}

export function createProductionCodexBackend(options: ProductionCodexBackendOptions): ProductionCodexBackend { return new ProductionCodexBackend(options); }
