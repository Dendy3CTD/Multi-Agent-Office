import { createInterface } from "node:readline";
import { isAbsolute, resolve } from "node:path";
import { type Readable, type Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createElectronicsTools, filterElectronicsToolsByCapabilities } from "./index.js";

interface LaunchOptions { readonly workspaceRoot: string; readonly allowedToolIds: readonly string[]; readonly employeeCapabilities: readonly string[]; }
export function createElectronicsMcpHandlers(options: LaunchOptions) {
  if (!isAbsolute(options.workspaceRoot) || options.allowedToolIds.length > 32 || options.employeeCapabilities.length > 64) throw new TypeError("Invalid task-scoped electronics MCP configuration");
  const toolset = createElectronicsTools({ workspaceRoot: options.workspaceRoot });
  const filtered = new Map(filterElectronicsToolsByCapabilities(toolset.tools, options.employeeCapabilities).map(tool => [tool.id, tool]));
  const tools = new Map<string, (args: unknown) => Promise<unknown>>();
  for (const id of options.allowedToolIds) {
    const tool = filtered.get(id);
    if (!tool || !id.startsWith("electronics.")) throw new TypeError(`Electronics tool ${id} is not allowed for this task`);
    tools.set(id, async args => await tool.execute(asRecord(args)));
  }
  return { tools, toolset };
}

export async function runElectronicsMcpServer(options: LaunchOptions, io: { readonly input?: Readable; readonly output?: Writable } = {}): Promise<void> {
  const { tools, toolset } = createElectronicsMcpHandlers(options);
  const input = createInterface({ input: io.input ?? process.stdin, crlfDelay: Infinity });
  const output = io.output ?? process.stdout;
  for await (const line of input) {
    if (line.length > 1_000_000) { send(output, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Message too large" } }); continue; }
    let message: Record<string, unknown>;
    try { const value: unknown = JSON.parse(line); if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") throw new Error(); message = value; }
    catch { send(output, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC message" } }); continue; }
    if (message.id === undefined) continue;
    const params = isRecord(message.params) ? message.params : {};
    try {
      if (message.method === "initialize") send(output, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "mao-electronics-tools", version: "0.1.0" } } });
      else if (message.method === "ping") send(output, { jsonrpc: "2.0", id: message.id, result: {} });
      else if (message.method === "tools/list") send(output, { jsonrpc: "2.0", id: message.id, result: { tools: [...tools.keys()].map(id => { const tool = toolset.get(id)!; return { name: id, description: tool.description, inputSchema: tool.inputSchema, ...(tool.annotations ? { annotations: tool.annotations } : {}) }; }) } });
      else if (message.method === "tools/call") {
        if (typeof params.name !== "string" || !tools.has(params.name)) { send(output, { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Tool is not permitted for this task" } }); continue; }
        const value = await tools.get(params.name)!(params.arguments ?? {});
        const failed = isRecord(value) && ["FAIL"].includes(String(value.status));
        send(output, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: safeJson(value) }], structuredContent: value, isError: failed } });
      } else send(output, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    } catch (error) { send(output, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : "Electronics tool call failed" }], isError: true } }); }
  }
}
function asRecord(value: unknown): Record<string, unknown> { if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>; throw new TypeError("Tool arguments must be an object"); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function safeJson(value: unknown): string { try { return JSON.stringify(value); } catch { return "Tool returned a non-serializable result"; } }
function send(output: Writable, value: unknown): void { output.write(`${JSON.stringify(value)}\n`); }
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const raw = process.argv[2]; if (!raw || raw.length > 32_000) throw new TypeError("Missing or oversized MCP launch options");
    const options: unknown = JSON.parse(raw);
    if (!isRecord(options) || typeof options.workspaceRoot !== "string" || !Array.isArray(options.allowedToolIds) || options.allowedToolIds.some(value => typeof value !== "string") || !Array.isArray(options.employeeCapabilities) || options.employeeCapabilities.some(value => typeof value !== "string")) throw new TypeError("Invalid task-scoped electronics MCP options");
    await runElectronicsMcpServer(options as unknown as LaunchOptions);
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Electronics MCP server failed"}\n`); process.exitCode = 1; }
}
