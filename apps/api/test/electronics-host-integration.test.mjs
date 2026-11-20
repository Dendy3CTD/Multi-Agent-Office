import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "@mao-hybrid/api";

function callMcp(server, name, args) {
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } },
  ];
  const output = execFileSync(server.command, server.args, { encoding: "utf8", input: messages.map(message => JSON.stringify(message)).join("\n") + "\n", timeout: 5_000 });
  return JSON.parse(output.trim().split("\n")[1]).result;
}

async function createProject(api, scratch, id, procurementBudget) {
  const workspaceRoot = join(scratch, id);
  await mkdir(workspaceRoot);
  api.company.registerProject({ id, name: id, workspaceRoot, procurementBudget });
  return workspaceRoot;
}

test("new Electronics MCP tools are routed by capability and procurement overrun blocks task completion", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-electronics-bom-host-"));
  let observedToolResult;
  const api = await createApiServer({
    config: { port: 0, dataDirectory: join(scratch, "data"), maxConcurrent: 2 },
    runtime: {
      available: () => true,
      async execute(input) {
        const binding = input.taskTools;
        assert.ok(binding.tools.some(tool => tool.id === "electronics.bom.validate"));
        assert.ok(binding.tools.some(tool => tool.id === "electronics.electrical.validate"));
        assert.ok(!binding.tools.some(tool => tool.id === "electronics.platformio.upload"));
        const server = binding.mcpServers.find(item => item.name === "mao_electronics");
        assert.ok(server);
        assert.ok(!server.approvedToolIds?.includes("electronics.bom.validate"), "new tools must retain per-call approval");
        const call = callMcp(server, "electronics.bom.validate", { items: [{ reference: "U1", manufacturer: "Acme", mpn: "MCU-1", quantity: 1, unitPrice: 125, currency: "USD", sourceUrl: "https://parts.example/U1", checkedAt: "2026-11-20T12:00:00Z", datasheetUrl: "https://parts.example/U1/datasheet" }] });
        observedToolResult = call.structuredContent;
        assert.equal(observedToolResult.status, "PASS");
        return { status: "completed", executionState: "terminated", text: "BOM checked.", toolCalls: [{ id: "bom-check-1", server: "mao_electronics", toolId: "electronics.bom.validate", status: "completed", result: observedToolResult }] };
      },
    },
  });
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  await createProject(api, scratch, "procurement-overrun", { amount: 100, currency: "USD" });
  const submitted = await api.company.submitAndRun({ projectId: "procurement-overrun", title: "Validate electronics BOM using electronics.bom.validate", brief: "Run electronics.bom.validate on the supplied component list.", complexity: "simple" });
  assert.equal(observedToolResult.costs[0].knownTotal, 125);
  assert.equal(submitted.task.status, "needs_review");
  assert.match(submitted.task.error, /procurement_budget_exceeded/);
});

test("UNSAFE electrical compatibility result is never accepted as a completed design", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-electronics-unsafe-host-"));
  const api = await createApiServer({
    config: { port: 0, dataDirectory: join(scratch, "data") },
    runtime: {
      available: () => true,
      async execute(input) {
        const server = input.taskTools.mcpServers.find(item => item.name === "mao_electronics");
        const call = callMcp(server, "electronics.electrical.validate", {
          components: [{ id: "mcu", datasheetUrl: "https://parts.example/mcu", gpio: { maxCurrent: 0.01, maxVoltage: 3.3 } }, { id: "motor", datasheetUrl: "https://parts.example/motor" }],
          supplies: [{ id: "motor-supply", voltage: 5, ratedCurrent: 1 }],
          loads: [{ componentId: "motor", kind: "motor", supplyId: "motor-supply", voltageMin: 4, voltageMax: 6, current: 0.5, gpioDirect: true, gpioComponentId: "mcu", driverComponentId: null, requiredProtection: [], protectionPresent: [], dissipation: 0.1, thermalLimit: 1 }],
          interfaces: [], connections: [],
        });
        assert.equal(call.structuredContent.status, "UNSAFE");
        return { status: "completed", executionState: "terminated", text: "Electrical validation completed.", toolCalls: [{ id: "electrical-check-1", server: "mao_electronics", toolId: "electronics.electrical.validate", status: "completed", result: call.structuredContent }] };
      },
    },
  });
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  await createProject(api, scratch, "unsafe-electrical", { amount: 100, currency: "USD" });
  const submitted = await api.company.submitAndRun({ projectId: "unsafe-electrical", title: "Run electronics.electrical.validate", brief: "Check electrical compatibility.", complexity: "simple" });
  assert.equal(submitted.task.status, "needs_review");
  assert.match(submitted.task.error, /mcp_tool_failed:mao_electronics\/electronics.electrical.validate/);
});
