import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOUNDED_ENGINEERING_TEST_CONFIRMATION, createApiServer } from "../dist/api.js";
import { createResearchProvider } from "../dist/research-provider.js";

const root = new URL("../../../", import.meta.url).pathname;

test("research host exposes only the employee's capability-filtered task MCP tools without auto-approval", async (t) => {
  const provider = createResearchProvider();
  const context = (professionId, skills = []) => ({ projectId: "p", taskId: "t", executionId: "e", workspaceRoot: root, employee: { id: professionId, professionId, skills } });
  const researcher = provider.create(context("research-analyst"));
  const researcherIds = researcher.summaries.map(tool => tool.id);
  assert.deepEqual(researcherIds, ["research.capabilities", "research.web.search", "research.datasheet.extract"]);
  assert.equal(researcher.mcpServers.length, 1);
  assert.equal(researcher.mcpServers[0].name, "mao_research");
  assert.equal(researcher.mcpServers[0].approvedToolIds, undefined);
  assert.equal(researcher.mcpServers[0].allowedTools.includes("research.component.search"), false);

  const electronics = provider.create(context("electronics-engineer", ["electronics"]));
  assert.deepEqual(electronics.summaries.map(tool => tool.id), [
    "research.capabilities", "research.web.search", "research.component.search", "research.component.inspect",
    "research.datasheet.extract", "research.component.compare", "research.bom.compile",
  ]);
  assert.equal(electronics.mcpServers[0].approvedToolIds, undefined);

  const child = spawn(process.execPath, researcher.mcpServers[0].args, { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill("SIGTERM"));
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  const call = async (id, method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const next = await iterator.next();
    assert.equal(next.done, false);
    return JSON.parse(next.value);
  };
  const listed = await call(1, "tools/list", {});
  assert.deepEqual(listed.result.tools.map(tool => tool.name), researcherIds);
  const forbidden = await call(2, "tools/call", { name: "research.component.search", arguments: { query: "sensor" } });
  assert.equal(forbidden.error.code, -32602);
});

test("confirmed bounded run carries Research provenance into BOM and records exactly two single-attempt stages", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-research-handoff-"));
  const workspaceRoot = join(scratch, "project");
  await mkdir(workspaceRoot);
  const received = [];
  const runtime = {
    available: () => true,
    supportsBudgetLimit: false,
    async execute(input) {
      received.push(input);
      assert.equal(input.step.maxAttempts, 1);
      assert.equal(input.step.safeRetry, false);
      assert.equal(input.budget, undefined, "bounded test is never represented as a monetary hard cap");
      const calls = input.step.id === "research"
        ? [
          { id: "search-1", toolId: "research.web.search", status: "completed", result: { toolId: "research.web.search", status: "UNVERIFIED", checkedAt: "2026-01-02T03:04:05.000Z", data: { results: [{ url: "https://www.ti.com/product/example", status: "UNVERIFIED", provenance: { sourceUrl: "https://html.duckduckgo.com/html/", sourceName: "DuckDuckGo", checkedAt: "2026-01-02T03:04:05.000Z", extraction: "search-result-title-and-snippet", evidence: "candidate result" } }] } } },
          { id: "datasheet-1", toolId: "research.datasheet.extract", status: "completed", result: { toolId: "research.datasheet.extract", status: "VERIFIED", checkedAt: "2026-01-02T03:04:06.000Z", data: { parameters: { supplyVoltage: { value: "3.3 V", status: "VERIFIED", provenance: { sourceUrl: "https://www.ti.com/lit/ds/example.pdf", sourceName: "TI datasheet", checkedAt: "2026-01-02T03:04:06.000Z", extraction: "datasheet-parameter:supplyVoltage", evidence: "Supply voltage is 3.3 V", page: 4 } } } } } },
        ]
        : [
          { id: "bom-1", toolId: "electronics.kicad.bom", status: "completed", result: { status: "completed" } },
          { id: "bom-validation-1", toolId: "electronics.bom.validate", status: "completed", result: { status: "PASS", costs: [{ currency: "USD", knownTotal: 42 }] } },
        ];
      if (input.step.id === "bom") {
        const handoff = input.step.handoffs[0].artifact;
        assert.equal(handoff.researchEvidence.length, 2);
        assert.equal(handoff.researchEvidence[0].status, "UNVERIFIED");
        assert.equal(handoff.researchEvidence[0].sources[0].status, "UNVERIFIED");
        assert.equal(handoff.researchEvidence[1].sources[0].url, "https://www.ti.com/lit/ds/example.pdf");
        assert.equal(handoff.researchEvidence[1].sources[0].checkedAt, "2026-01-02T03:04:06.000Z");
        assert.equal(handoff.researchEvidence[1].sources[0].status, "VERIFIED");
      }
      const kind = input.step.id;
      const artifact = { schemaVersion: 1, id: `${kind}-artifact`, kind, status: "verified", summary: `${kind} complete`, items: [{ id: `${kind}-item` }], files: [], sourceEvidence: kind === "research" ? [{ toolId: "research.datasheet.extract", callId: "datasheet-1" }] : [{ toolId: "electronics.bom.validate", callId: "bom-validation-1" }], assumptions: [], ...(kind === "bom" ? { basedOnArtifactIds: ["research-artifact"] } : {}) };
      return { status: "completed", executionState: "terminated", toolCalls: calls, text: `ENGINEERING_ARTIFACT_JSON: ${JSON.stringify(artifact)}` };
    },
  };
  const api = await createApiServer({ config: { port: 0, dataDirectory: join(scratch, "data"), maxConcurrent: 2 }, runtime });
  const address = await api.listen();
  const origin = `http://${address.host}:${address.port}`;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });

  const rejected = await fetch(`${origin}/api/engineering/test-runs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation: "", stepCount: 8, maxAttemptsPerStage: 2 }),
  });
  assert.equal(rejected.status, 400);
  assert.equal(received.length, 0, "no runtime launch occurs without the exact explicit confirmation");

  const response = await fetch(`${origin}/api/engineering/test-runs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "bounded-research-bom", name: "Bounded Research BOM", workspaceRoot, brief: "Test Research to BOM evidence handoff.",
      procurementBudget: { amount: 100, currency: "USD" }, executionBudget: { amount: 25, currency: "USD" },
      confirmation: BOUNDED_ENGINEERING_TEST_CONFIRMATION, stepCount: 2, maxAttemptsPerStage: 1,
    }),
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const result = await response.json();
  assert.equal(result.testRun.monetaryHardCap, false);
  assert.deepEqual(result.testRun.steps.map(step => step.id), ["research", "bom"]);
  assert.deepEqual(result.testRun.steps.map(step => step.status), ["completed", "completed"], JSON.stringify(result.testRun.steps.map(step => ({ id: step.id, error: step.error }))));
  assert.equal(received.length, 2);
  assert.equal(received[0].taskTools.mcpServers.find(server => server.name === "mao_research").approvedToolIds, undefined);
  assert.ok(api.store.getTask(result.testRun.task.id).events.some(event => event.type === "engineering.bounded_test_confirmed" && event.monetaryHardCap === false));
});

test("Research cannot mark an UNVERIFIED citation as a verified artifact", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-research-status-gate-"));
  const workspaceRoot = join(scratch, "project");
  await mkdir(workspaceRoot);
  let calls = 0;
  const api = await createApiServer({
    config: { port: 0, dataDirectory: join(scratch, "data"), maxConcurrent: 2 },
    runtime: {
      available: () => true, supportsBudgetLimit: false,
      async execute(input) {
        calls++;
        const toolCalls = [
          { id: "search", toolId: "research.web.search", status: "completed", result: { status: "UNVERIFIED", checkedAt: "2026-01-02T03:04:05.000Z", data: { results: [] } } },
          { id: "datasheet", toolId: "research.datasheet.extract", status: "completed", result: { status: "VERIFIED", checkedAt: "2026-01-02T03:04:06.000Z", data: {} } },
        ];
        const artifact = { schemaVersion: 1, id: "research-claim", kind: "research", status: "verified", summary: "Claimed verified from search output", items: [{ id: "candidate", unitPrice: 12 }], files: [], sourceEvidence: [{ toolId: "research.web.search", callId: "search" }], assumptions: [] };
        return { status: "completed", executionState: "terminated", toolCalls, text: `ENGINEERING_ARTIFACT_JSON: ${JSON.stringify(artifact)}` };
      },
    },
  });
  const address = await api.listen();
  const origin = `http://${address.host}:${address.port}`;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  const response = await fetch(`${origin}/api/engineering/test-runs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "unverified-research", name: "Unverified Research", workspaceRoot, brief: "Validate status gate", procurementBudget: { amount: 100, currency: "USD" }, executionBudget: { amount: 20, currency: "USD" }, confirmation: BOUNDED_ENGINEERING_TEST_CONFIRMATION, stepCount: 2, maxAttemptsPerStage: 1 }),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.testRun.steps[0].status, "needs_review");
  assert.match(result.testRun.steps[0].error, /verified_without_verified_source/);
  assert.equal(result.testRun.steps[1].status, "queued");
  assert.equal(calls, 1);
});
