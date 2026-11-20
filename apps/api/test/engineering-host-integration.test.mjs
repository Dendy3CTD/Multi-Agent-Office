import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createEngineeringConsistencyProvider, ENGINEERING_CONSISTENCY_TOOL_ID } from "../dist/engineering-consistency-provider.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("host-scoped consistency MCP calls the real manifest contract and blocks inconsistent or unknown inputs", async (t) => {
  const provider = createEngineeringConsistencyProvider();
  const instance = provider.create({ projectId: "fixture-project", taskId: "fixture-task", executionId: "fixture-execution", workspaceRoot: root, employee: { id: "qa-fixture", professionId: "qa-engineer", skills: [] } });
  assert.deepEqual(instance.summaries.map(tool => tool.id), [ENGINEERING_CONSISTENCY_TOOL_ID]);
  assert.equal(instance.mcpServers[0].approvedToolIds, undefined, "host integration must retain prompt approval policy");

  const child = spawn(process.execPath, instance.mcpServers[0].args, { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { child.kill("SIGTERM"); });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  const call = async (id, method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const next = await iterator.next();
    assert.equal(next.done, false, "MCP host should return a JSON-RPC result");
    return JSON.parse(next.value);
  };
  const initialized = await call(1, "initialize", { protocolVersion: "2025-03-26" });
  assert.equal(initialized.result.serverInfo.name, "mao-engineering-consistency");
  const listed = await call(5, "tools/list", {});
  assert.deepEqual(listed.result.tools.map(tool => tool.name), [ENGINEERING_CONSISTENCY_TOOL_ID]);
  assert.equal(listed.result.tools[0].annotations.readOnlyHint, true);

  const consistent = JSON.parse(await readFile(new URL("../../../packages/engineering-consistency/test/fixtures/consistent-project.json", import.meta.url), "utf8"));
  const ready = await call(2, "tools/call", { name: ENGINEERING_CONSISTENCY_TOOL_ID, arguments: consistent });
  assert.equal(ready.result.structuredContent.status, "READY_TO_BUILD");
  assert.equal(ready.result.isError, false);

  const contradictory = JSON.parse(await readFile(new URL("../../../packages/engineering-consistency/test/fixtures/contradictory-project.json", import.meta.url), "utf8"));
  const blocked = await call(3, "tools/call", { name: ENGINEERING_CONSISTENCY_TOOL_ID, arguments: contradictory });
  assert.equal(blocked.result.structuredContent.status, "BLOCKED");
  assert.equal(blocked.result.isError, true);
  assert.ok(blocked.result.structuredContent.unconfirmed.length > 0);

  const unknown = structuredClone(consistent);
  delete unknown.schematic.components[0].physicalDimensionsMm;
  const unknownResult = await call(4, "tools/call", { name: ENGINEERING_CONSISTENCY_TOOL_ID, arguments: unknown });
  assert.equal(unknownResult.result.structuredContent.status, "BLOCKED");
  assert.ok(unknownResult.result.structuredContent.unconfirmed.some(issue => issue.code === "component_dimensions_unconfirmed"));
});
