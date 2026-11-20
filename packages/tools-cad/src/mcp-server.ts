import { createInterface } from "node:readline";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskCadDispatcher, cadCapabilitiesForEmployee, type CadEmployee } from "./index.js";

interface CadLaunchOptions {
  readonly projectId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly workspaceRoot: string;
  readonly allowedToolIds: readonly string[];
  readonly employeeCapabilities: readonly string[];
  readonly approvedToolIds: readonly string[];
  readonly employee: CadEmployee;
}

export async function runCadMcpServer(options: CadLaunchOptions): Promise<void> {
  if (![options.projectId, options.taskId, options.executionId].every(value => typeof value === "string" && value.length > 0 && value.length <= 160) ||
      !isAbsolute(options.workspaceRoot) || !Array.isArray(options.allowedToolIds) || options.allowedToolIds.length > 10 ||
      !Array.isArray(options.employeeCapabilities) || options.employeeCapabilities.length > 64 ||
      !Array.isArray(options.approvedToolIds) || options.approvedToolIds.length > 10 ||
      !options.employee || typeof options.employee.professionId !== "string") throw new TypeError("Invalid task-scoped CAD MCP configuration");
  if (!cadCapabilitiesForEmployee(options.employee).some(capability => ["cad", "3d"].includes(capability))) throw new TypeError("Selected employee has no CAD capability");
  if (options.employeeCapabilities.some(capability => !cadCapabilitiesForEmployee(options.employee).includes(capability))) throw new TypeError("CAD launch capabilities do not match employee capabilities");
  const dispatcher = createTaskCadDispatcher(options);
  const mcpServer = dispatcher.mcpServer;
  if (!mcpServer || options.allowedToolIds.some((id, index) => mcpServer.allowedTools[index] !== id) || options.allowedToolIds.length !== mcpServer.allowedTools.length) throw new TypeError("Task CAD tool list does not match employee capabilities");
  if (options.approvedToolIds.some(id => !mcpServer.approvedToolIds?.includes(id))) throw new TypeError("CAD per-tool approval is outside the trusted allowlist");

  const tools = new Map(dispatcher.tools.map(tool => [tool.id, tool]));
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (line.length > 1_000_000) { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Message too large" } }); continue; }
    let message: Record<string, unknown>;
    try {
      const decoded: unknown = JSON.parse(line);
      if (!isRecord(decoded) || decoded.jsonrpc !== "2.0" || typeof decoded.method !== "string") throw new TypeError("Invalid JSON-RPC message");
      message = decoded;
    } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC message" } }); continue; }
    if (message.id === undefined) continue;
    const params = isRecord(message.params) ? message.params : {};
    const id = message.id;
    try {
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "mao-cad-tools", version: "1.0.0" } } });
      } else if (message.method === "ping") send({ jsonrpc: "2.0", id: message.id, result: {} });
      else if (message.method === "tools/list") send({ jsonrpc: "2.0", id: message.id, result: { tools: dispatcher.tools.map(tool => ({ name: tool.id, description: tool.description, inputSchema: tool.inputSchema, ...(tool.annotations ? { annotations: tool.annotations } : {}) })) } });
      else if (message.method === "tools/call") {
        if (typeof params.name !== "string" || !tools.has(params.name)) { send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "CAD tool is not permitted for this task" } }); continue; }
        const args = params.arguments ?? {};
        if (!isRecord(args)) throw new TypeError("CAD tool arguments must be a JSON object");
        const result = await dispatcher.invoke(params.name, args);
        const isError = result.status === "FAIL" || result.status === "NEEDS_REVIEW";
        send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError } });
      } else send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.slice(0, 1_000) : "CAD tool call failed";
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: errorMessage }], isError: true } });
    }
  }
}

function send(value: unknown): void { process.stdout.write(JSON.stringify(value) + "\n"); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const raw = process.argv[2];
    if (!raw || raw.length > 32_000) throw new TypeError("Missing or oversized CAD MCP launch options");
    const options: unknown = JSON.parse(raw);
    if (!isRecord(options) || typeof options.projectId !== "string" || typeof options.taskId !== "string" || typeof options.executionId !== "string" || typeof options.workspaceRoot !== "string" || !Array.isArray(options.allowedToolIds) || options.allowedToolIds.some(item => typeof item !== "string") || !Array.isArray(options.employeeCapabilities) || options.employeeCapabilities.some(item => typeof item !== "string") || !Array.isArray(options.approvedToolIds) || options.approvedToolIds.some(item => typeof item !== "string") || !isRecord(options.employee) || typeof options.employee.id !== "string" || typeof options.employee.professionId !== "string" || !Array.isArray(options.employee.skills) || options.employee.skills.some(item => typeof item !== "string")) throw new TypeError("Invalid CAD MCP launch options");
    await runCadMcpServer(options as unknown as CadLaunchOptions);
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : "CAD MCP server failed") + "\n");
    process.exitCode = 1;
  }
}
