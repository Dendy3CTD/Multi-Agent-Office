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
    body: JSON.stringify({ projectId: "demo", title: "Read a file", brief: "Read-only test task", complexity: "simple" }),
  });
  assert.equal(taskResponse.status, 200);
  const body = await taskResponse.json();
  assert.equal(body.task.status, "completed");
  assert.equal(body.steps[0].result.text, "API result");
  assert.equal(api.store.listTasks().length, 1);
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
