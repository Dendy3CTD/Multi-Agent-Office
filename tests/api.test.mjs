import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "@mao-hybrid/api";
import { createEventBus } from "@mao-hybrid/events";

test("POST /api/tasks runs the existing Company and Task Store path and returns a persisted Codex result", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-api-"));
  const workspace = join(scratch, "workspace");
  await mkdir(workspace);
  const events = createEventBus();
  const runtime = {
    available: () => true,
    async execute(input) {
      events.publish({ taskId: input.task.id, executionId: input.executionId, type: "agent.message", data: { text: "API result" } });
      return { status: "completed", text: "API result", result: { text: "API result" }, executionState: "terminated" };
    },
    async inspect() { return { status: "unknown", executionState: "unknown" }; },
  };
  const api = await createApiServer({ config: { host: "127.0.0.1", port: 0, dataDirectory: join(scratch, "data"), maxConcurrent: 2 }, runtime, events });
  const address = await api.listen();
  const origin = "http://127.0.0.1:" + address.port;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });

  const project = await fetch(origin + "/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "demo", name: "Demo", workspaceRoot: workspace }) });
  assert.equal(project.status, 201);
  const taskResponse = await fetch(origin + "/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "demo-run-1" },
    // Avoid "test" in the task text: the API treats that as a request for coding.check.run evidence.
    body: JSON.stringify({ projectId: "demo", title: "Read a file", brief: "Read-only API fixture", complexity: "simple" }),
  });
  assert.equal(taskResponse.status, 200);
  const body = await taskResponse.json();
  assert.equal(body.task.status, "completed");
  assert.equal(body.steps[0].result.text, "API result");
  assert.equal(api.store.listTasks().length, 1);
  const persisted = api.store.getTask(body.task.id);
  assert.equal(persisted.task.status, "completed");
  assert.equal(persisted.steps[0].status, "completed");
  assert.deepEqual(persisted.steps[0].result, body.steps[0].result);
  const fetched = await fetch(origin + `/api/tasks/${body.task.id}`).then(response => response.json());
  assert.equal(fetched.task.status, "completed");
  assert.deepEqual(fetched.steps[0].result, body.steps[0].result);
  const status = await fetch(origin + "/api/status").then(response => response.json());
  assert.equal(status.maxConcurrent, 2);
});

test("task submission fails closed when Codex Runtime is unavailable", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-api-unavailable-"));
  const workspace = join(scratch, "workspace");
  await mkdir(workspace);
  const api = await createApiServer({ config: { port: 0, dataDirectory: join(scratch, "data") }, runtime: { available: () => false, async execute() { throw new Error("must not run"); } } });
  const address = await api.listen();
  const origin = "http://127.0.0.1:" + address.port;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  await fetch(origin + "/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "demo", name: "Demo", workspaceRoot: workspace }) });
  const response = await fetch(origin + "/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "demo", title: "No runtime", brief: "Must reject" }) });
  assert.equal(response.status, 503);
  assert.equal(api.store.listTasks().length, 0);
});

test("API distinguishes adding tests from explicitly running them", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-api-check-intent-"));
  const workspace = join(scratch, "workspace");
  await mkdir(workspace);
  const received = [];
  const runtime = {
    available: () => true,
    async execute(input) {
      received.push({ title: input.task.title, requiredToolIds: input.taskTools.requiredToolIds });
      return { status: "completed", text: "Task result" };
    },
  };
  const api = await createApiServer({ config: { port: 0, dataDirectory: join(scratch, "data") }, runtime });
  const address = await api.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  await fetch(`${origin}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "python-project", name: "Python project", workspaceRoot: workspace }),
  });

  const addOnlyResponse = await fetch(`${origin}/api/tasks`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "add-test-files-only" },
    body: JSON.stringify({ projectId: "python-project", title: "Create a Python greeting package", brief: "Add unit tests and a README. Do not run the test suite.", complexity: "simple" }),
  });
  const addOnly = await addOnlyResponse.json();
  assert.equal(addOnly.task.status, "completed");
  assert.deepEqual(received[0].requiredToolIds, []);

  const runResponse = await fetch(`${origin}/api/tasks`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "explicitly-run-pytest" },
    body: JSON.stringify({ projectId: "python-project", title: "Run the Python test suite", brief: "Run pytest and report the actual result.", complexity: "simple" }),
  });
  const runTask = await runResponse.json();
  assert.deepEqual(received[1].requiredToolIds, ["coding.check.run"]);
  assert.equal(runTask.task.status, "needs_review", "an explicit test run without real tool evidence must not pass");
});
