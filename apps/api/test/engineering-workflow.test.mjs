import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "@mao-hybrid/api";

const stages = ["requirements", "research", "bom", "electronics", "firmware", "cad", "verification", "documentation"];

test("keeps the eight-stage workflow fail-closed when Runtime cannot enforce the AI execution budget", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-engineering-workflow-"));
  const workspaceRoot = join(scratch, "project");
  await mkdir(workspaceRoot);
  const received = [];
  const runtime = {
    available: () => true,
    supportsBudgetLimit: false,
    async execute(input) { received.push(input); throw new Error("must remain fail-closed"); },
  };
  const api = await createApiServer({ config: { port: 0, dataDirectory: join(scratch, "data"), maxConcurrent: 2 }, runtime });
  const address = await api.listen();
  const origin = `http://${address.host}:${address.port}`;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });

  const response = await fetch(`${origin}/api/engineering/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "engineering-controller-alpha" },
    body: JSON.stringify({
      id: "controller-alpha", name: "Controller Alpha", workspaceRoot,
      brief: "Design a low-voltage sensor controller from requirements through documentation.",
      procurementBudget: { amount: 180, currency: "USD" },
      executionBudget: { amount: 250, currency: "USD" },
    }),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.project.procurementBudget.amount, 180);
  assert.equal(result.project.executionBudget.amount, 250);
  assert.equal(result.workflow.steps.length, 8);
  assert.deepEqual(result.workflow.steps.map((step) => step.id), stages);
  assert.deepEqual(result.workflow.steps.map((step) => step.dependsOn), [[], ...stages.slice(0, -1).map((id) => [id])]);
  assert.equal(result.workflow.task.status, "needs_review");
  assert.equal(result.workflow.steps[0].status, "needs_review");
  assert.match(result.workflow.steps[0].error, /budget_enforcement_unavailable/);
  assert.equal(result.workflow.steps[1].status, "queued");
  assert.equal(received.length, 0, "automatic eight-stage execution is blocked without a confirmed hard cap");

  const manifestResponse = await fetch(`${origin}/api/projects/controller-alpha/manifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.validation.designStatus, "IN_PROGRESS");
  assert.equal(manifest.validation.hardwareStatus, "NOT_VALIDATED");
  assert.equal(manifest.artifacts.length, 0);
});

test("does not allow hardware validation status without a physical test record", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-engineering-hardware-gate-"));
  const workspaceRoot = join(scratch, "project");
  await mkdir(workspaceRoot);
  const api = await createApiServer({
    config: { port: 0, dataDirectory: join(scratch, "data") },
    runtime: { available: () => false, supportsBudgetLimit: false, async execute() { throw new Error("must not execute"); } },
  });
  const address = await api.listen();
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  const origin = `http://${address.host}:${address.port}`;

  const response = await fetch(`${origin}/api/engineering/projects`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "hardware-gate", name: "Hardware Gate", workspaceRoot, brief: "A controller", procurementBudget: { amount: 75, currency: "USD" }, executionBudget: { amount: 100, currency: "USD" } }),
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.workflow.task.status, "needs_review");
  assert.match(created.workflow.steps[0].error, /runtime_unavailable|budget_enforcement_unavailable/);
  const manifest = await (await fetch(`${origin}/api/projects/hardware-gate/manifest`)).json();
  assert.equal(manifest.validation.hardwareStatus, "NOT_VALIDATED");
  assert.equal(manifest.validation.hardwareEvidence.length, 0);
});

test("retries only the failed stage and preserves successful stage artifacts", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-engineering-retry-"));
  const workspaceRoot = join(scratch, "project");
  await mkdir(workspaceRoot);
  const api = await createApiServer({
    config: { port: 0, dataDirectory: join(scratch, "data") },
    runtime: {
      available: () => true,
      supportsBudgetLimit: true,
      async execute(input) {
        if (input.step.id === "research") return { status: "failed", error: "source lookup failed", executionState: "terminated" };
        return { status: "completed", text: "ENGINEERING_ARTIFACT_JSON: {\"schemaVersion\":1,\"kind\":\"requirements\",\"id\":\"requirements-retry-v1\",\"status\":\"draft\",\"summary\":\"Requirements baseline\",\"items\":[{\"id\":\"REQ-1\",\"description\":\"Provide regulated 3.3 V sensor input\"}],\"files\":[],\"sourceEvidence\":[],\"assumptions\":[]}" };
      },
    },
    taskToolProviders: [{ id: "research-test-provider", capabilities: ["research-sources"], create: () => ({ summaries: [], mcpServers: [], async invoke() { throw new Error("no tools registered"); } }) }],
  });
  const address = await api.listen();
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  const origin = `http://${address.host}:${address.port}`;
  const createdResponse = await fetch(`${origin}/api/engineering/projects`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "retry-project", name: "Retry Project", workspaceRoot, brief: "A controller", procurementBudget: { amount: 75, currency: "USD" }, executionBudget: { amount: 100, currency: "USD" } }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.workflow.steps[0].status, "completed");
  assert.equal(created.workflow.steps[1].status, "failed");
  const retryResponse = await fetch(`${origin}/api/tasks/${created.workflow.task.id}/steps/research/retry`, { method: "POST" });
  assert.equal(retryResponse.status, 200);
  const retried = await retryResponse.json();
  assert.equal(retried.steps[0].result.engineeringArtifact.id, "requirements-retry-v1");
  assert.equal(retried.steps[1].attempts, 2);
  assert.equal(retried.steps[1].status, "failed");
  const exhausted = await fetch(`${origin}/api/tasks/${created.workflow.task.id}/steps/research/retry`, { method: "POST" });
  assert.equal(exhausted.status, 409);
});

test("blocks registered firmware upload tools before runtime dispatch", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-engineering-dangerous-tool-"));
  const workspaceRoot = join(scratch, "project");
  await mkdir(workspaceRoot);
  let runtimeCalls = 0;
  const api = await createApiServer({
    config: { port: 0, dataDirectory: join(scratch, "data") },
    runtime: { available: () => true, supportsBudgetLimit: true, async execute() { runtimeCalls += 1; return { status: "failed" }; } },
    taskToolProviders: [{
      id: "unsafe-test-provider",
      create: () => ({
        summaries: [{ id: "electronics.platformio.upload", name: "Upload firmware", description: "Upload to physical board", inputSchema: { type: "object" } }],
        mcpServers: [{ name: "unsafe-test", command: "unused", args: [], allowedTools: ["electronics.platformio.upload"] }],
        async invoke() { throw new Error("must not dispatch"); },
      }),
    }],
  });
  const address = await api.listen();
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  const response = await fetch(`http://${address.host}:${address.port}/api/engineering/projects`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "safe-project", name: "Safe Project", workspaceRoot, brief: "A controller", procurementBudget: { amount: 60, currency: "USD" }, executionBudget: { amount: 80, currency: "USD" } }),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.workflow.steps[0].status, "needs_review");
  assert.match(result.workflow.steps[0].error, /automatic_operation_forbidden/);
  assert.equal(runtimeCalls, 0);
});
