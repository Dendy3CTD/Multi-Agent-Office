import { accessSync, constants, existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentEvent, RuntimeAdapter, RuntimeExecutionInput, RuntimeResult } from "@mao-hybrid/contracts";
import type { EventBus } from "@mao-hybrid/events";

export type CodexSandbox = "read-only" | "workspace-write";

export interface CodexRuntimeOptions {
  readonly executable: string;
  readonly sandbox?: CodexSandbox;
  readonly model?: string;
  readonly events?: EventBus;
}

export interface CodexRuntime extends RuntimeAdapter {
  available(): boolean;
  version(): Promise<string | undefined>;
}

export function createCodexRuntime(options: CodexRuntimeOptions): CodexRuntime {
  const executable = resolveExecutable(options.executable);
  const sandbox = options.sandbox ?? "workspace-write";
  const active = new Map<string, ChildProcess>();
  return {
    available: () => Boolean(executable),
    async version() {
      if (!executable) return undefined;
      try {
        const result = await runVersion(executable);
        return result.match(/codex-cli\s+([^\s]+)/i)?.[1];
      } catch { return undefined; }
    },
    async execute(input: RuntimeExecutionInput): Promise<RuntimeResult> {
      if (!executable) return { status: "failed", error: "codex_executable_unavailable", executionState: "terminated" };
      if (!isAbsoluteWorkspace(input.workingDirectory)) return { status: "failed", error: "workspace_path_invalid", executionState: "terminated" };
      const args = ["exec", "--json", "--sandbox", sandbox, "--cd", input.workingDirectory, "--skip-git-repo-check"];
      if (options.model) args.push("--model", options.model);
      args.push(input.step.prompt);
      const child = spawn(executable, args, { cwd: input.workingDirectory, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      active.set(input.executionId, child);
      child.stderr?.resume();
      const abort = () => { if (child.exitCode === null) child.kill("SIGTERM"); };
      if (input.signal.aborted) abort();
      else input.signal.addEventListener("abort", abort, { once: true });
      let spawnFailed = false;
      child.once("error", () => { spawnFailed = true; });
      const eventTaskId = input.task.id;
      const emit = (type: string, data: Readonly<Record<string, unknown>>) => options.events?.publish({ taskId: eventTaskId, executionId: input.executionId, type, data });
      let response = "";
      try {
        const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
        for await (const line of lines) {
          let message: Record<string, unknown>;
          try {
            const decoded: unknown = JSON.parse(line);
            if (!isRecord(decoded)) continue;
            message = decoded;
          } catch { continue; }
          if (message.type === "thread.started" && isIdentifier(message.thread_id)) emit("session.started", { sessionId: message.thread_id });
          if (message.type === "item.started" || message.type === "item.completed") {
            const item = isRecord(message.item) ? message.item : undefined;
            if (!item) continue;
            if (item.type === "agent_message" && message.type === "item.completed" && typeof item.text === "string") {
              response = item.text;
              emit("agent.message", { text: item.text });
            } else if (["command_execution", "mcp_tool_call", "file_change"].includes(String(item.type))) {
              const type = message.type === "item.started" ? "tool.started" : "tool.completed";
              emit(type, { tool: String(item.type), ...(isIdentifier(item.id) ? { itemId: item.id } : {}) });
            }
          }
        }
        const result = await waitForClose(child);
        if (input.signal.aborted) return { status: "failed", error: "execution_cancelled", executionState: "terminated" };
        if (spawnFailed || result.code !== 0 || result.signal !== null) {
          emit("runtime.failed", { code: "codex_execution_failed" });
          return { status: "failed", error: spawnFailed ? "codex_spawn_failed" : "codex_execution_failed", executionState: result.signal === null && result.code !== null ? "terminated" : "unknown" };
        }
        emit("runtime.completed", { result: response });
        return { status: "completed", text: response, result: { text: response }, executionState: "terminated" };
      } catch {
        emit("runtime.failed", { code: "codex_execution_failed" });
        return { status: "failed", error: "codex_execution_failed", executionState: "unknown" };
      } finally {
        input.signal.removeEventListener("abort", abort);
        if (active.get(input.executionId) === child) active.delete(input.executionId);
        if (child.exitCode === null) child.kill("SIGTERM");
      }
    },
    async inspect(input) {
      const child = active.get(input.executionId);
      if (child && child.exitCode === null && child.signalCode === null) return { status: "running", executionState: "running" };
      return { status: "unknown", executionState: "unknown", reason: "codex_process_not_observable_after_restart" };
    },
  };
}

function resolveExecutable(input: string): string | undefined {
  if (!input || input.includes("\0")) return undefined;
  const candidates = isAbsoluteWorkspace(input) ? [input] : (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").map(directory => directory + "/" + input);
  for (const candidate of candidates) {
    try { if (existsSync(candidate)) { accessSync(candidate, constants.X_OK); return candidate; } } catch { /* try next path */ }
  }
  return undefined;
}

async function runVersion(executable: string): Promise<string> {
  const child = spawn(executable, ["--version"], { shell: false, stdio: ["ignore", "pipe", "ignore"] });
  let stdout = "";
  child.stdout?.on("data", chunk => { stdout += String(chunk).slice(0, 200); });
  const result = await waitForClose(child);
  if (result.code !== 0) throw new Error("Codex CLI version check failed");
  return stdout;
}
function waitForClose(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isIdentifier(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f]/.test(value); }
function isAbsoluteWorkspace(path: string): boolean { return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path); }
