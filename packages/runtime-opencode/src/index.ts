import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { isAbsolute, resolve } from "node:path";
import type { SpawnOptions } from "node:child_process";

export type RuntimeReason = "stop" | "tool-calls";

export interface RuntimeUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
}

export interface RuntimeEvent {
  readonly type?: string;
  readonly [key: string]: unknown;
}

export interface RuntimeTaskOptions {
  model: string;
  prompt: string;
  cwd: string;
  title: string;
  sessionId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: RuntimeEvent) => void;
  /**
   * Receives the normalized usage delta of one event (only for events that carry
   * token metrics). The deltas sum up to RuntimeResult.usage. Called before onEvent,
   * so usage is delivered even if onEvent throws. `event` is already redacted.
   */
  onUsage?: (usage: RuntimeUsage, event: RuntimeEvent) => void;
}

export interface RuntimeResult {
  sessionId?: string;
  text: string;
  events: RuntimeEvent[];
  exitCode: number;
  reason: RuntimeReason;
  usage: RuntimeUsage;
}

export interface OpenCodeRuntimeOptions {
  command?: string;
  spawn?: SpawnFunction;
  maxBufferBytes?: number;
  terminateGraceMs?: number;
}

export type SpawnFunction = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

const REDACTED = "[REDACTED]";
const STDERR_TRUNCATED = "[stderr truncated]";
const SENSITIVE_KEY = /^(?:authorization|api[_-]?key|access[_-]?token|token|password|secret)$/i;

function redactSecrets(value: string): string {
  return value
    .replace(/(\bAuthorization\s*:\s*Bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/(\bapi[_-]?key\s*[=:]\s*)(["']?)[^\s,"'`;}]+\2/gi, `$1${REDACTED}`)
    .replace(/(\baccess_token\s*[=:]\s*)(["']?)[^\s,"'`;}]+\2/gi, `$1${REDACTED}`)
    .replace(/("?(?:token|password|secret)"?\s*:\s*)"[^"]*"/gi, `$1"${REDACTED}"`)
    .replace(/(\b(?:token|password|secret)\s*[=:]\s*)(["']?)[^\s,"'`;}]+\2/gi, `$1${REDACTED}`);
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  const record = objectValue(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)]));
}

function sanitizeEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  return events.map((event) => sanitizeValue(event) as RuntimeEvent);
}

function boundedAppend(current: string, addition: string, maxBytes: number, marker: string): { value: string; truncated: boolean } {
  const combined = Buffer.concat([Buffer.from(current), Buffer.from(addition)]);
  if (combined.byteLength <= maxBytes) return { value: combined.toString(), truncated: false };
  const markerBuffer = Buffer.from(marker);
  if (maxBytes <= markerBuffer.byteLength) return { value: markerBuffer.subarray(0, maxBytes).toString(), truncated: true };
  return { value: `${combined.subarray(0, maxBytes - markerBuffer.byteLength).toString()}${marker}`, truncated: true };
}

export class RuntimeError extends Error {
  readonly events: RuntimeEvent[];
  readonly stderr: string;
  readonly exitCode?: number;

  constructor(message: string, details: { events?: RuntimeEvent[]; stderr?: string; exitCode?: number } = {}) {
    super(redactSecrets(message));
    this.name = new.target.name;
    this.events = sanitizeEvents(details.events ?? []);
    this.stderr = redactSecrets(details.stderr ?? "");
    this.exitCode = details.exitCode;
  }
}

export class OpenCodeLaunchError extends RuntimeError {}
export class RuntimeTimeoutError extends RuntimeError {}
export class RuntimeAbortError extends RuntimeError {}
export class RuntimeProtocolError extends RuntimeError {}
export class RuntimeModelError extends RuntimeError {}
export class RuntimeEventCallbackError extends RuntimeError {}
export class RuntimeUsageCallbackError extends RuntimeError {}
export class RuntimeExitError extends RuntimeError {}
export class RuntimeIncompleteError extends RuntimeError {}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const DEFAULT_TERMINATE_GRACE_MS = 1500;

const emptyUsage = (): RuntimeUsage => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  cost: 0,
});

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function textFrom(event: RuntimeEvent): string {
  const part = objectValue(event.part);
  const candidates = [event.text, part?.text, objectValue(event.message)?.text];
  return candidates.find((value): value is string => typeof value === "string") ?? "";
}

function sessionFrom(event: RuntimeEvent): string | undefined {
  for (const value of [event.sessionID, event.sessionId, event.session_id, objectValue(event.session)?.id]) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function reasonFrom(event: RuntimeEvent): RuntimeReason | undefined {
  const part = objectValue(event.part);
  const reason = event.reason ?? part?.reason;
  return reason === "stop" || reason === "tool-calls" ? reason : undefined;
}

/**
 * Extracts the normalized usage delta of one event. Returns undefined when the
 * event carries no token metrics, so such events are never reported as usage.
 */
function usageDeltaFrom(event: RuntimeEvent): RuntimeUsage | undefined {
  const part = objectValue(event.part);
  const tokens = objectValue(event.tokens) ?? objectValue(part?.tokens) ?? objectValue(event.usage);
  if (!tokens) return undefined;
  const delta = emptyUsage();
  const cache = objectValue(tokens.cache);
  const input = finiteNumber(tokens.input);
  const output = finiteNumber(tokens.output);
  const reasoning = finiteNumber(tokens.reasoning);
  const cacheRead = finiteNumber(tokens.cacheRead ?? tokens.cache_read ?? cache?.read);
  const cacheWrite = finiteNumber(tokens.cacheWrite ?? tokens.cache_write ?? cache?.write);
  delta.input = input ?? 0;
  delta.output = output ?? 0;
  delta.reasoning = reasoning ?? 0;
  delta.cacheRead = cacheRead ?? 0;
  delta.cacheWrite = cacheWrite ?? 0;
  const total = finiteNumber(tokens.total);
  delta.total = total ?? ((input ?? 0) + (output ?? 0) + (reasoning ?? 0));
  const cost = finiteNumber(event.cost ?? part?.cost ?? tokens.cost);
  delta.cost = cost ?? 0;
  return delta;
}

function accumulateUsage(total: RuntimeUsage, delta: RuntimeUsage): void {
  total.input += delta.input;
  total.output += delta.output;
  total.reasoning += delta.reasoning;
  total.cacheRead += delta.cacheRead;
  total.cacheWrite += delta.cacheWrite;
  total.total += delta.total;
  total.cost += delta.cost;
}

export class OpenCodeRuntime {
  private readonly command: string;
  private readonly spawnProcess: SpawnFunction;
  private readonly maxBufferBytes: number;
  private readonly terminateGraceMs: number;

  constructor(options: OpenCodeRuntimeOptions = {}) {
    const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    const terminateGraceMs = options.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS;
    if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes <= 0) {
      throw new RangeError("maxBufferBytes must be a positive safe integer");
    }
    if (!Number.isSafeInteger(terminateGraceMs) || terminateGraceMs < 0) {
      throw new RangeError("terminateGraceMs must be a non-negative safe integer");
    }
    this.command = options.command ?? "opencode";
    this.spawnProcess = options.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions));
    this.maxBufferBytes = maxBufferBytes;
    this.terminateGraceMs = terminateGraceMs;
  }

  runTask(options: RuntimeTaskOptions): Promise<RuntimeResult> {
    if (!options.model || !options.prompt || !options.title) {
      return Promise.reject(new OpenCodeLaunchError("model, prompt and title are required"));
    }
    if (!isAbsolute(options.cwd)) {
      return Promise.reject(new OpenCodeLaunchError("cwd must be an absolute path"));
    }
    if (options.signal?.aborted) return Promise.reject(new RuntimeAbortError("Task was aborted before launch"));
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new OpenCodeLaunchError("timeoutMs must be a positive finite number"));
    }

    const args = ["run", "--dir", resolve(options.cwd), "--model", options.model, "--format", "json", "--title", options.title];
    if (options.sessionId) args.push("--session", options.sessionId);
    args.push(options.prompt);
    return this.execute(options, args, timeoutMs);
  }

  private execute(options: RuntimeTaskOptions, args: string[], timeoutMs: number): Promise<RuntimeResult> {
    return new Promise((resolvePromise, rejectPromise) => {
      const events: RuntimeEvent[] = [];
      const usage = emptyUsage();
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let stdoutBytes = 0;
      let stdoutRemainder = "";
      let stderr = "";
      let stderrTruncated = false;
      let stderrEnded = false;
      let stdoutEnded = false;
      let text = "";
      let sessionId: string | undefined;
      let finalReason: RuntimeReason | undefined;
      let settled = false;
      let closeSeen = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      let killHandle: NodeJS.Timeout | undefined;
      let child: ChildProcess;
      let abortListener: (() => void) | undefined;
      let pendingFailure: (() => RuntimeError) | undefined;

      const finish = (error?: RuntimeError, result?: RuntimeResult) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (killHandle) clearTimeout(killHandle);
        if (abortListener && options.signal) options.signal.removeEventListener("abort", abortListener);
        error ? rejectPromise(error) : resolvePromise(result as RuntimeResult);
      };
      const terminate = () => {
        if (!child || closeSeen) return;
        try { child.kill("SIGTERM"); } catch { /* process may have exited */ }
        if (closeSeen) return;
        killHandle = setTimeout(() => {
          if (!closeSeen) {
            try { child.kill("SIGKILL"); } catch { /* process may have exited */ }
          }
        }, this.terminateGraceMs);
      };
      const protocolFailure = (message: string) => {
        if (settled || pendingFailure) return;
        pendingFailure = () => new RuntimeProtocolError(message, { events, stderr });
        terminate();
      };
      const modelFailure = () => {
        if (settled || pendingFailure) return;
        pendingFailure = () => new RuntimeModelError("OpenCode reported a model error", { events, stderr });
        terminate();
      };
      const callbackFailure = (cause: unknown) => {
        if (settled || pendingFailure) return;
        const message = cause instanceof Error ? cause.message : "onEvent callback failed";
        pendingFailure = () => new RuntimeEventCallbackError(`onEvent callback failed: ${message}`, { events, stderr });
        terminate();
      };
      const usageCallbackFailure = (cause: unknown) => {
        if (settled || pendingFailure) return;
        const message = cause instanceof Error ? cause.message : "onUsage callback failed";
        pendingFailure = () => new RuntimeUsageCallbackError(`onUsage callback failed: ${message}`, { events, stderr });
        terminate();
      };
      const processLine = (line: string): boolean => {
        if (!line.trim()) return true;
        let event: RuntimeEvent;
        try {
          const parsed: unknown = JSON.parse(line);
          const record = objectValue(parsed);
          if (!record) throw new Error("event is not an object");
          event = sanitizeValue(record) as RuntimeEvent;
        } catch {
          protocolFailure("OpenCode emitted invalid JSONL");
          return false;
        }
        events.push(event);
        sessionId ??= sessionFrom(event);
        text += textFrom(event);
        // Usage is aggregated and reported before onEvent, so a throwing onEvent cannot lose it.
        const delta = usageDeltaFrom(event);
        if (delta) {
          accumulateUsage(usage, delta);
          try {
            options.onUsage?.(delta, event);
          } catch (cause) {
            usageCallbackFailure(cause);
            return false;
          }
        }
        try {
          options.onEvent?.(event);
        } catch (cause) {
          callbackFailure(cause);
          return false;
        }
        if (event.type === "step_finish") {
          const stepReason = reasonFrom(event);
          if (stepReason === "stop") finalReason = "stop";
          else if (finalReason !== "stop") finalReason = stepReason ?? finalReason;
        }
        if (event.type === "error") {
          modelFailure();
          return false;
        }
        return true;
      };
      const processText = (chunk: string) => {
        stdoutRemainder += chunk;
        let newline = stdoutRemainder.indexOf("\n");
        while (newline >= 0) {
          const line = stdoutRemainder.slice(0, newline).replace(/\r$/, "");
          stdoutRemainder = stdoutRemainder.slice(newline + 1);
          if (!processLine(line)) return;
          newline = stdoutRemainder.indexOf("\n");
        }
      };
      const consume = (chunk: Buffer | string) => {
        if (settled || stdoutEnded) return;
        stdoutBytes += Buffer.byteLength(chunk);
        if (stdoutBytes > this.maxBufferBytes) return protocolFailure("OpenCode stdout exceeded the configured buffer limit");
        processText(stdoutDecoder.write(chunk));
      };
      const appendStderr = (chunk: string) => {
        if (stderrTruncated || !chunk) return;
        const result = boundedAppend(stderr, chunk, this.maxBufferBytes, STDERR_TRUNCATED);
        stderr = result.value;
        stderrTruncated = result.truncated;
      };
      try {
        child = this.spawnProcess(this.command, args, { cwd: resolve(options.cwd), shell: false, stdio: ["ignore", "pipe", "pipe"] });
        if (!child.stdout || !child.stderr) throw new Error("OpenCode pipes were not created");
      } catch (cause) {
        finish(new OpenCodeLaunchError(`Unable to launch OpenCode: ${cause instanceof Error ? cause.message : "unknown error"}`));
        return;
      }
      child.stdout!.on("data", consume);
      child.stderr!.on("data", (chunk: Buffer | string) => {
        if (stderrEnded) return;
        appendStderr(stderrDecoder.write(chunk));
      });
      child.once("spawn", () => undefined);
      child.once("error", (cause) => {
        if (!pendingFailure) finish(new OpenCodeLaunchError(`OpenCode process error: ${cause.message}`, { events, stderr }));
      });
      child.once("close", (exitCode) => {
        closeSeen = true;
        if (killHandle) clearTimeout(killHandle);
        stdoutEnded = true;
        const tail = stdoutDecoder.end();
        if (tail && !settled) processText(tail);
        stderrEnded = true;
        appendStderr(stderrDecoder.end());
        if (stdoutRemainder.trim() && !settled) {
          const lastLine = stdoutRemainder;
          stdoutRemainder = "";
          processLine(lastLine);
        }
        if (settled) return;
        if (pendingFailure) return finish(pendingFailure());
        if (exitCode !== 0) return finish(new RuntimeExitError(`OpenCode exited with code ${exitCode ?? "unknown"}`, { events, stderr, exitCode: exitCode ?? undefined }));
        if (finalReason !== "stop") return finish(new RuntimeIncompleteError("OpenCode did not provide a final step_finish event with reason=stop", { events, stderr, exitCode: exitCode ?? undefined }));
        finish(undefined, { sessionId, text, events, exitCode: exitCode ?? 0, reason: finalReason, usage });
      });
      abortListener = () => {
        if (settled || pendingFailure) return;
        pendingFailure = () => new RuntimeAbortError("OpenCode task was aborted", { events, stderr });
        terminate();
      };
      options.signal?.addEventListener("abort", abortListener, { once: true });
      timeoutHandle = setTimeout(() => {
        if (settled || pendingFailure) return;
        pendingFailure = () => new RuntimeTimeoutError(`OpenCode task exceeded ${timeoutMs}ms`, { events, stderr });
        terminate();
      }, timeoutMs);
    });
  }
}

export default OpenCodeRuntime;
