import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createTaskElectronicsDispatcher, createElectronicsTools } from "../dist/index.js";
import { runElectronicsMcpServer } from "../dist/mcp-server.js";

test("task dispatcher and stdio MCP expose only capability-authorized electronics tools", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mao-electronics-mcp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const engineer = createTaskElectronicsDispatcher({ projectId: "p", taskId: "t", executionId: "e", workspaceRoot: root, employee: { professionId: "electronics-engineer", skills: [] } });
  const other = createTaskElectronicsDispatcher({ projectId: "p", taskId: "other", executionId: "e2", workspaceRoot: root, employee: { professionId: "developer", skills: [] } });
  assert.ok(engineer.tools.length > 0);
  assert.equal(other.tools.length, 0);
  assert.equal(engineer.mcpServer.name, "mao_electronics");
  const launch = JSON.parse(engineer.mcpServer.args[1]);
  const input = new PassThrough(); const rpcOutput = new PassThrough(); const stdout = [];
  rpcOutput.on("data", chunk => stdout.push(chunk));
  const done = runElectronicsMcpServer({ workspaceRoot: root, allowedToolIds: engineer.mcpServer.allowedTools, employeeCapabilities: launch.employeeCapabilities }, { input, output: rpcOutput });
  input.end([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "electronics.components.validate", arguments: { components: [{ id: "U1", limits: {} }], checks: [] } } },
  ].map(item => JSON.stringify(item)).join("\n") + "\n");
  await done;
  const outputText = Buffer.concat(stdout).toString().trim();
  assert.ok(outputText, "MCP server produced no JSON-RPC output");
  const messages = outputText.split("\n").map(line => JSON.parse(line));
  const list = messages.find(item => item.id === 2).result.tools;
  assert.ok(list.some(item => item.name === "electronics.ngspice.run"));
  assert.ok(list.every(item => item.name.startsWith("electronics.")));
  const validation = messages.find(item => item.id === 3).result.structuredContent;
  assert.equal(validation.status, "NEEDS_DATASHEET");
  assert.equal(validation.toolId, "electronics.components.validate");
});

test("flash, erase, serial, and reset tools are not registered", () => {
  const tools = createElectronicsTools({ workspaceRoot: "/tmp" }).tools;
  assert.equal(tools.some(tool => /flash|erase|serial|reset|upload/i.test(tool.id)), false);
});
