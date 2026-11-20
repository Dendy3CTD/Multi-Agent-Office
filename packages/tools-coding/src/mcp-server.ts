import { createInterface } from "node:readline";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCodingTools, enforceCodingToolInputCapabilities, filterCodingToolsByCapabilities } from "./index.js";

interface McpLaunchOptions {
  readonly workspaceRoot: string;
  readonly repositoryRoot: string;
  readonly allowedToolIds: readonly string[];
  readonly employeeCapabilities: readonly string[];
  readonly allowExternalWrites: boolean;
  readonly allowLocalGitWrites?: boolean;
}

export async function runCodingMcpServer(options: McpLaunchOptions): Promise<void> {
  if (!isAbsolute(options.workspaceRoot) || !isAbsolute(options.repositoryRoot) || !Array.isArray(options.allowedToolIds) || options.allowedToolIds.length > 64 || !Array.isArray(options.employeeCapabilities) || options.employeeCapabilities.length > 64) {
    throw new TypeError("Invalid task-scoped Coding Tools MCP configuration");
  }
  const toolset = createCodingTools({ workspaceRoot: options.workspaceRoot, repositoryRoot: options.repositoryRoot, allowExternalWrites: options.allowExternalWrites === true, allowLocalGitWrites: options.allowLocalGitWrites === true });
  const permitted = new Map<string, (input: unknown) => Promise<unknown> | unknown>();
  const filtered = new Map(filterCodingToolsByCapabilities(toolset.tools, options.employeeCapabilities).map(tool => [tool.id, tool]));
  for (const id of options.allowedToolIds) {
    if (!filtered.has(id)) throw new TypeError(`Task-scoped MCP tool ${id} does not match the selected employee capabilities`);
    const tool = toolset.get(id);
    if (!tool || id === "coding.github.push" || id === "coding.github.create-pr" || id === "coding.github.merge-pr") {
      throw new TypeError(`Task-scoped MCP configuration contains a forbidden tool ID: ${id}`);
    }
    permitted.set(id, (input) => tool.execute(input));
  }

  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (line.length > 1_000_000) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Message too large" } });
      continue;
    }
    let message: Record<string, unknown>;
    try {
      const decoded: unknown = JSON.parse(line);
      if (!isRecord(decoded) || decoded.jsonrpc !== "2.0" || typeof decoded.method !== "string") throw new TypeError("Invalid JSON-RPC message");
      message = decoded;
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC message" } });
      continue;
    }
    if (message.id === undefined) continue;
    const params = isRecord(message.params) ? message.params : {};
    try {
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "mao-coding-tools", version: "1.0.0" } } });
      } else if (message.method === "ping") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
      } else if (message.method === "tools/list") {
        send({ jsonrpc: "2.0", id: message.id, result: { tools: [...permitted.keys()].map(id => {
          const tool = toolset.get(id)!;
          return { name: tool.id, description: tool.description, inputSchema: tool.inputSchema, ...(tool.annotations ? { annotations: tool.annotations } : {}) };
        }) } });
      } else if (message.method === "tools/call") {
        if (typeof params.name !== "string" || !permitted.has(params.name)) {
          send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Tool is not permitted for this task" } });
          continue;
        }
        const args = params.arguments ?? {};
        enforceCodingToolInputCapabilities(params.name, args, options.employeeCapabilities);
        const value = await permitted.get(params.name)!(args);
        // `blocked` is a structured domain outcome (for example, no Git repo),
        // while `failed` and `timed_out` mean the tool execution itself failed.
        const isError = isRecord(value) && ["failed", "timed_out"].includes(String(value.status));
        send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: safeJson(value) }], structuredContent: value, isError } });
      } else {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
      }
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : "Tool call failed" }], isError: true } });
    }
  }
}

function send(value: unknown): void { process.stdout.write(JSON.stringify(value) + "\n"); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function safeJson(value: unknown): string { try { return JSON.stringify(value); } catch { return "Tool returned a non-serializable result"; } }

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const raw = process.argv[2];
    if (!raw || raw.length > 32_000) throw new TypeError("Missing or oversized MCP launch options");
    const options: unknown = JSON.parse(raw);
    if (!isRecord(options) || typeof options.workspaceRoot !== "string" || typeof options.repositoryRoot !== "string" || !Array.isArray(options.allowedToolIds) || options.allowedToolIds.some(value => typeof value !== "string") || !Array.isArray(options.employeeCapabilities) || options.employeeCapabilities.some(value => typeof value !== "string") || options.allowExternalWrites !== false || typeof options.allowLocalGitWrites !== "boolean") throw new TypeError("Invalid MCP launch options");
    await runCodingMcpServer(options as unknown as McpLaunchOptions);
  } catch (error) {
    // The protocol owns stdout; diagnostics go to stderr only.
    process.stderr.write((error instanceof Error ? error.message : "Coding MCP server failed") + "\n");
    process.exitCode = 1;
  }
}
