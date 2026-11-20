import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { analyzeEngineeringProject, type EngineeringProjectManifest } from "@mao-hybrid/engineering-consistency";
import { ENGINEERING_CONSISTENCY_TOOL_ID, ENGINEERING_CONSISTENCY_TOOL_SUMMARY } from "./engineering-consistency-provider.js";

interface LaunchOptions { readonly projectId: string; readonly taskId: string; readonly executionId: string; readonly allowedToolIds: readonly string[]; }

export async function runEngineeringConsistencyMcpServer(options: LaunchOptions, io: { readonly input?: Readable; readonly output?: Writable } = {}): Promise<void> {
  if (!options || ![options.projectId, options.taskId, options.executionId].every(value => typeof value === "string" && value.length > 0) || options.allowedToolIds.length !== 1 || options.allowedToolIds[0] !== ENGINEERING_CONSISTENCY_TOOL_ID) {
    throw new TypeError("Invalid task-scoped Engineering Consistency MCP configuration");
  }
  const input = createInterface({ input: io.input ?? process.stdin, crlfDelay: Infinity });
  const output = io.output ?? process.stdout;
  for await (const line of input) {
    if (line.length > 1_000_000) { send(output, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Message too large" } }); continue; }
    let message: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") throw new Error();
      message = value;
    } catch { send(output, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC message" } }); continue; }
    if (message.id === undefined) continue;
    const params = isRecord(message.params) ? message.params : {};
    try {
      if (message.method === "initialize") send(output, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "mao-engineering-consistency", version: "0.1.0" } } });
      else if (message.method === "ping") send(output, { jsonrpc: "2.0", id: message.id, result: {} });
      else if (message.method === "tools/list") send(output, { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: ENGINEERING_CONSISTENCY_TOOL_ID, description: ENGINEERING_CONSISTENCY_TOOL_SUMMARY.description, inputSchema: ENGINEERING_CONSISTENCY_TOOL_SUMMARY.inputSchema, annotations: ENGINEERING_CONSISTENCY_TOOL_SUMMARY.annotations }] } });
      else if (message.method === "tools/call") {
        if (params.name !== ENGINEERING_CONSISTENCY_TOOL_ID) { send(output, { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Tool is not permitted for this task" } }); continue; }
        const report = analyzeEngineeringProject(params.arguments as EngineeringProjectManifest);
        send(output, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(report) }], structuredContent: report, isError: report.status !== "READY_TO_BUILD" } });
      } else send(output, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    } catch (cause) {
      send(output, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: cause instanceof Error ? cause.message : "Consistency validation failed" }], isError: true } });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function send(output: Writable, value: unknown): void { output.write(`${JSON.stringify(value)}\n`); }

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const launch = JSON.parse(process.argv[2] ?? "") as LaunchOptions;
    await runEngineeringConsistencyMcpServer(launch);
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : "Engineering Consistency MCP failed"}\n`);
    process.exitCode = 1;
  }
}
