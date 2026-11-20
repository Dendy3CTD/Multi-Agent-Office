import { accessSync, constants, existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { CODEX_AUTO_APPROVED_CAD_TOOLS, CODEX_AUTO_APPROVED_CODING_READ_ONLY_TOOLS, CODEX_AUTO_APPROVED_ELECTRONICS_TOOLS, type RuntimeAdapter, type RuntimeExecutionInput, type RuntimeMcpServerConfig, type RuntimeResult, type RuntimeToolCallEvidence, type ToolSummary } from "@mao-hybrid/contracts";
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
      const exposedTools = new Set(input.taskTools?.tools.map(tool => tool.id) ?? []);
      const mcpServers = input.taskTools?.mcpServers ?? [];
      if (new Set(mcpServers.map(server => server.name)).size !== mcpServers.length || new Set(mcpServers.flatMap(server => server.allowedTools)).size !== mcpServers.reduce((count, server) => count + server.allowedTools.length, 0)) {
        return { status: "failed", error: "task_tool_name_conflict", executionState: "terminated" };
      }
      for (const server of mcpServers) {
        if (!/^[a-z][a-z0-9_-]{1,63}$/.test(server.name) || !isAbsoluteWorkspace(server.command) || server.args.length > 16 || server.args.some(arg => typeof arg !== "string" || arg.includes("\0")) || server.allowedTools.length > 64 || new Set(server.allowedTools).size !== server.allowedTools.length || server.allowedTools.some(id => !/^[a-z][a-z0-9_.-]{1,95}$/.test(id) || !exposedTools.has(id))) {
          return { status: "failed", error: "task_tool_server_config_invalid", executionState: "terminated" };
        }
        if (server.name === "mao_coding" && !isTrustedCodingServer(server, input)) {
          return { status: "failed", error: "task_coding_server_binding_invalid", executionState: "terminated" };
        }
        if (server.name === "mao_electronics" && !isTrustedElectronicsServer(server, input)) {
          return { status: "failed", error: "task_electronics_server_binding_invalid", executionState: "terminated" };
        }
        if (server.name === "mao_cad" && !isTrustedCadServer(server, input)) {
          return { status: "failed", error: "task_cad_server_binding_invalid", executionState: "terminated" };
        }
        if (server.approvedToolIds?.length && !["mao_coding", "mao_electronics", "mao_cad"].includes(server.name)) {
          return { status: "failed", error: "task_tool_approval_config_invalid", executionState: "terminated" };
        }
        args.push("--config", `mcp_servers.${server.name}.command=${JSON.stringify(server.command)}`);
        args.push("--config", `mcp_servers.${server.name}.args=${JSON.stringify(server.args)}`);
        args.push("--config", `mcp_servers.${server.name}.enabled=true`);
        args.push("--config", `mcp_servers.${server.name}.required=true`);
        args.push("--config", `mcp_servers.${server.name}.startup_timeout_sec=10`);
        args.push("--config", `mcp_servers.${server.name}.enabled_tools=${JSON.stringify(server.allowedTools)}`);
        args.push("--config", `mcp_servers.${server.name}.default_tools_approval_mode="prompt"`);
        if (["mao_coding", "mao_electronics", "mao_cad"].includes(server.name)) {
          const summaries = new Map(input.taskTools?.tools.map(tool => [tool.id, tool]) ?? []);
          const autoApprovedTools = server.name === "mao_coding"
            ? server.allowedTools.filter(toolId => {
              const annotations = summaries.get(toolId)?.annotations;
              return (CODEX_AUTO_APPROVED_CODING_READ_ONLY_TOOLS as readonly string[]).includes(toolId) && annotations?.readOnlyHint === true && annotations.destructiveHint !== true && annotations.openWorldHint !== true;
            })
            : server.name === "mao_electronics" ? validateApprovedElectronicsTools(server, summaries) : validateApprovedCadTools(server, summaries);
          // Codex CLI dotted-path overrides split every `.` in a key; a tool ID
          // like `coding.git.status` must be placed inside a TOML inline table
          // value so it remains one literal per-tool key.
          if (autoApprovedTools.length) {
            const toolsTable = autoApprovedTools.map(toolId => `${JSON.stringify(toolId)}={approval_mode="approve"}`).join(",");
            args.push("--config", `mcp_servers.${server.name}.tools={${toolsTable}}`);
          }
        }
      }
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
      const toolCalls = new Map<string, RuntimeToolCallEvidence>();
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
            } else if (item.type === "mcp_tool_call") {
              const callId = isIdentifier(item.id) ? item.id : `mcp-call-${toolCalls.size + 1}`;
              const server = isIdentifier(item.server) ? item.server : "unknown_server";
              const toolId = isIdentifier(item.tool) ? item.tool : "unknown_tool";
              if (message.type === "item.started") {
                toolCalls.set(callId, { id: callId, server, toolId, status: "unknown" });
                emit("tool.started", { tool: "mcp_tool_call", itemId: callId, server, toolName: toolId });
              } else {
                const error = mcpToolError(item);
                const resultIsError = isRecord(item.result) && item.result.isError === true;
                const resultValue = isRecord(item.result) ? mcpToolResult(item.result) : undefined;
                const resultFailed = isToolResultFailure(resultValue);
                const successfulResult = isRecord(item.result) && error === undefined && !resultIsError;
                const status: RuntimeToolCallEvidence["status"] = item.status === "completed" && successfulResult && !resultFailed
                  ? "completed"
                  : isMcpRejection(error) ? "rejected"
                    : item.status === "failed" || error !== undefined || resultIsError || resultFailed ? "failed" : "unknown";
                const reportedError = error ?? (resultIsError ? "MCP tool returned isError=true" : resultFailed ? `MCP tool returned ${String((resultValue as Record<string, unknown>).status)}` : undefined);
                const evidence: RuntimeToolCallEvidence = {
                  id: callId, server, toolId, status,
                  ...(resultValue !== undefined ? { result: resultValue } : {}),
                  ...(reportedError !== undefined ? { error: reportedError } : {}),
                };
                toolCalls.set(callId, evidence);
                const eventType = status === "completed" ? "tool.completed" : status === "rejected" ? "tool.rejected" : status === "failed" ? "tool.failed" : "tool.unknown";
                emit(eventType, { tool: "mcp_tool_call", itemId: callId, server, toolName: toolId, status, ...(resultValue !== undefined ? { result: resultValue } : {}), ...(reportedError !== undefined ? { error: reportedError } : {}) });
              }
            } else if (["command_execution", "file_change"].includes(String(item.type))) {
              const type = message.type === "item.started" ? "tool.started" : item.status === "failed" || item.status === "declined" ? "tool.failed" : "tool.completed";
              emit(type, {
                tool: String(item.type),
                ...(isIdentifier(item.id) ? { itemId: item.id } : {}),
                ...(isIdentifier(item.server) ? { server: item.server } : {}),
                ...(isIdentifier(item.tool) ? { toolName: item.tool } : {}),
                ...(typeof item.status === "string" ? { status: item.status } : {}),
              });
            }
          }
        }
        const result = await waitForClose(child);
        if (input.signal.aborted) return { status: "failed", error: "execution_cancelled", executionState: "terminated" };
        if (spawnFailed || result.code !== 0 || result.signal !== null) {
          emit("runtime.failed", { code: "codex_execution_failed" });
          return { status: "failed", error: spawnFailed ? "codex_spawn_failed" : "codex_execution_failed", executionState: result.signal === null && result.code !== null ? "terminated" : "unknown", toolCalls: [...toolCalls.values()] };
        }
        const failedToolCall = [...toolCalls.values()].find(call => call.status !== "completed");
        if (failedToolCall) {
          const error = `mcp_tool_${failedToolCall.status}:${failedToolCall.server}/${failedToolCall.toolId}`;
          emit("runtime.needs_review", { code: error });
          return { status: "needs_review", error, text: response, result: { text: response }, executionState: "terminated", toolCalls: [...toolCalls.values()] };
        }
        const blockedToolCall = [...toolCalls.values()].find(call => isToolResultBlocked(call.result));
        if (blockedToolCall) {
          const reasonCode = isRecord(blockedToolCall.result) && typeof blockedToolCall.result.reasonCode === "string" ? `:${blockedToolCall.result.reasonCode}` : "";
          const error = `mcp_tool_blocked:${blockedToolCall.server}/${blockedToolCall.toolId}${reasonCode}`;
          emit("runtime.needs_review", { code: error });
          return { status: "needs_review", error, text: response, result: { text: response }, executionState: "terminated", toolCalls: [...toolCalls.values()] };
        }
        const requiredTool = input.taskTools?.requiredToolIds?.find(requiredId => ![...toolCalls.values()].some(call => call.status === "completed" && call.toolId === requiredId));
        if (requiredTool) {
          const error = `required_mcp_tool_not_executed:${requiredTool}`;
          emit("runtime.needs_review", { code: error });
          return { status: "needs_review", error, text: response, result: { text: response }, executionState: "terminated", toolCalls: [...toolCalls.values()] };
        }
        emit("runtime.completed", { result: response });
        return { status: "completed", text: response, result: { text: response }, executionState: "terminated", toolCalls: [...toolCalls.values()] };
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
function isTrustedCodingServer(server: RuntimeMcpServerConfig, input: RuntimeExecutionInput): boolean {
  if (server.command !== process.execPath || server.args.length !== 2 || !isAbsoluteWorkspace(server.args[0] ?? "") || !/[\\/]mcp-server\.js$/.test(server.args[0] ?? "")) return false;
  let options: unknown;
  try { options = JSON.parse(server.args[1] ?? ""); } catch { return false; }
  if (!isRecord(options) || options.workspaceRoot !== input.project.workspaceRoot || options.allowExternalWrites !== false || typeof options.allowLocalGitWrites !== "boolean" || !Array.isArray(options.allowedToolIds) || !Array.isArray(options.employeeCapabilities) || options.employeeCapabilities.some(value => typeof value !== "string")) return false;
  const allowed = options.allowedToolIds;
  if (allowed.some(value => typeof value !== "string") || allowed.length !== server.allowedTools.length || allowed.some((value, index) => value !== server.allowedTools[index])) return false;
  const repositoryRoot = options.repositoryRoot;
  if (typeof repositoryRoot !== "string" || !isAbsoluteWorkspace(repositoryRoot)) return false;
  const relativeRoot = relative(resolve(input.project.workspaceRoot), resolve(repositoryRoot));
  return relativeRoot === "" || (relativeRoot !== ".." && !relativeRoot.startsWith(`..${sep}`) && !isAbsoluteWorkspace(relativeRoot));
}
function isTrustedElectronicsServer(server: RuntimeMcpServerConfig, input: RuntimeExecutionInput): boolean {
  if (server.command !== process.execPath || server.args.length !== 2 || !isAbsoluteWorkspace(server.args[0] ?? "") || !/[\\/]tools-electronics[\\/]dist[\\/]mcp-server\.js$/.test(server.args[0] ?? "")) return false;
  let options: unknown;
  try { options = JSON.parse(server.args[1] ?? ""); } catch { return false; }
  if (!isRecord(options) || options.workspaceRoot !== input.project.workspaceRoot || !Array.isArray(options.allowedToolIds) || !Array.isArray(options.employeeCapabilities) || options.employeeCapabilities.some(value => typeof value !== "string") || !options.employeeCapabilities.some(value => ["electronics", "kicad", "ngspice", "component-validation", "embedded-build"].includes(value))) return false;
  if (options.allowedToolIds.some(value => typeof value !== "string" || !value.startsWith("electronics.")) || options.allowedToolIds.length !== server.allowedTools.length || options.allowedToolIds.some((value, index) => value !== server.allowedTools[index])) return false;
  const approved = options.approvedToolIds;
  return Array.isArray(approved) && approved.length === (server.approvedToolIds?.length ?? 0) && approved.every((value, index) => value === server.approvedToolIds?.[index]);
}
function isTrustedCadServer(server: RuntimeMcpServerConfig, input: RuntimeExecutionInput): boolean {
  if (server.command !== process.execPath || server.args.length !== 2 || !isAbsoluteWorkspace(server.args[0] ?? "") || !/[\\/]tools-cad[\\/]dist[\\/]mcp-server\.js$/.test(server.args[0] ?? "")) return false;
  let options: unknown;
  try { options = JSON.parse(server.args[1] ?? ""); } catch { return false; }
  if (!isRecord(options) || options.projectId !== input.project.id || options.taskId !== input.task.id || options.executionId !== input.executionId || options.workspaceRoot !== input.project.workspaceRoot || !Array.isArray(options.allowedToolIds) || !Array.isArray(options.employeeCapabilities) || options.employeeCapabilities.some(value => typeof value !== "string") || !isRecord(options.employee)) return false;
  if (options.employee.id !== input.employee.id || options.employee.professionId !== input.employee.professionId || !Array.isArray(options.employee.skills) || options.employee.skills.some(value => typeof value !== "string") || !options.employeeCapabilities.some(value => value === "cad" || value === "3d")) return false;
  const allowed = options.allowedToolIds;
  if (allowed.some(value => typeof value !== "string" || !value.startsWith("cad.")) || allowed.length !== server.allowedTools.length || allowed.some((value, index) => value !== server.allowedTools[index])) return false;
  const approved = options.approvedToolIds;
  return Array.isArray(approved) && approved.length === (server.approvedToolIds?.length ?? 0) && approved.every((value, index) => value === server.approvedToolIds?.[index]);
}
function validateApprovedElectronicsTools(server: RuntimeMcpServerConfig, summaries: Map<string, ToolSummary>): string[] {
  const approved = server.approvedToolIds ?? [];
  if (approved.length > 8 || new Set(approved).size !== approved.length || approved.some(id => !(CODEX_AUTO_APPROVED_ELECTRONICS_TOOLS as readonly string[]).includes(id) || !server.allowedTools.includes(id) || !summaries.has(id))) throw new TypeError("task_electronics_approval_config_invalid");
  return [...approved];
}
function validateApprovedCadTools(server: RuntimeMcpServerConfig, summaries: Map<string, ToolSummary>): string[] {
  const approved = server.approvedToolIds ?? [];
  if (approved.length > 10 || new Set(approved).size !== approved.length || approved.some(id => !(CODEX_AUTO_APPROVED_CAD_TOOLS as readonly string[]).includes(id) || !server.allowedTools.includes(id) || !summaries.has(id))) throw new TypeError("task_cad_approval_config_invalid");
  return [...approved];
}
function mcpToolError(item: Record<string, unknown>): string | undefined {
  if (isRecord(item.error) && typeof item.error.message === "string") return item.error.message.slice(0, 1_000);
  return undefined;
}
function isMcpRejection(error: string | undefined): boolean {
  return Boolean(error && /requires approval|approval policy|not permitted|not available to the model|permission denied|was rejected|blocked by (?:the )?(?:task|tool|server) configuration/i.test(error));
}
function mcpToolResult(result: Record<string, unknown>): unknown {
  if ("structured_content" in result) return result.structured_content;
  if ("structuredContent" in result) return result.structuredContent;
  return result.content ?? result;
}
function isToolResultFailure(result: unknown): boolean {
  return isRecord(result) && ["failed", "timed_out", "FAIL", "NEEDS_REVIEW", "NEEDS_DATASHEET"].includes(String(result.status));
}
function isToolResultBlocked(result: unknown): boolean { return isRecord(result) && ["BLOCKED", "blocked"].includes(String(result.status)); }
