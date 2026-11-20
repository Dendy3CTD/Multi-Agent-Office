import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteTaskStore } from "../src/index.js";

test("persists projects, plans, idempotency, attempts, and results across store restart", () => {
  const root = mkdtempSync(join(tmpdir(), "mao-hybrid-store-"));
  const filename = join(root, "tasks.sqlite");
  try {
    let store = new SqliteTaskStore({ filename, maxConcurrent: 2 });
    store.registerProject({ id: "project-a", name: "A", workspaceRoot: join(root, "workspace-a") });
    const created = store.createTaskPlan({
      idempotencyKey: "task-a-1",
      request: { projectId: "project-a", title: "Build a board", brief: "Implement and verify the board" },
      steps: [{ id: "implement", title: "Implement", prompt: "Build it", roleId: "developer", employeeId: "employee-001", maxAttempts: 2 }],
    });
    assert.equal(created.task.status, "queued");
    assert.equal(store.createTaskPlan({
      idempotencyKey: "task-a-1",
      request: { projectId: "project-a", title: "Build a board", brief: "Implement and verify the board" },
      steps: [{ id: "implement", title: "Implement", prompt: "Build it", roleId: "developer", employeeId: "employee-001", maxAttempts: 2 }],
    }).task.id, created.task.id);

    const claimed = store.claimNext();
    assert.equal(claimed.step.executionId, `${created.task.id}:implement:attempt:1`);
    store.close();
    store = new SqliteTaskStore({ filename, maxConcurrent: 2 });
    assert.equal(store.getTask(created.task.id).task.status, "running");
    assert.equal(store.getTask(created.task.id).steps[0].executionId, claimed.step.executionId);
    assert.equal(store.getTask(created.task.id).project.workspaceRoot, join(root, "workspace-a"));
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("claims at most two different employees and never reclaims an in-flight execution", () => {
  const root = mkdtempSync(join(tmpdir(), "mao-hybrid-slots-"));
  const store = new SqliteTaskStore({ filename: join(root, "tasks.sqlite"), maxConcurrent: 2 });
  try {
    store.registerProject({ id: "a", name: "A", workspaceRoot: join(root, "a") });
    store.registerProject({ id: "b", name: "B", workspaceRoot: join(root, "b") });
    for (const [id, employeeId] of [["one", "employee-001"], ["two", "employee-002"], ["three", "employee-003"]]) {
      store.createTaskPlan({ idempotencyKey: id, request: { projectId: id === "one" ? "a" : "b", title: id, brief: id },
        steps: [{ id: "work", title: "Work", prompt: id, roleId: "developer", employeeId }] });
    }
    assert.equal(store.claimNext().step.employeeId, "employee-001");
    assert.equal(store.claimNext().step.employeeId, "employee-002");
    assert.equal(store.claimNext(), undefined);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("persists runtime evidence on a needs_review step and its execution attempt across restart", () => {
  const root = mkdtempSync(join(tmpdir(), "mao-hybrid-blocked-result-"));
  const filename = join(root, "tasks.sqlite");
  let store;
  try {
    store = new SqliteTaskStore({ filename, maxConcurrent: 2 });
    store.registerProject({ id: "plain-project", name: "Plain", workspaceRoot: join(root, "workspace") });
    const created = store.createTaskPlan({
      idempotencyKey: "not-a-repository",
      request: { projectId: "plain-project", title: "Read Git status", brief: "Report Git status if available" },
      steps: [{ id: "work", title: "Read status", prompt: "Call coding.git.status", roleId: "developer", employeeId: "employee-013" }],
    });
    store.claimNext();
    const result = { status: "needs_review", error: "mcp_tool_blocked:mao_coding/coding.git.status:not_repository", toolCalls: [{ server: "mao_coding", toolId: "coding.git.status", status: "completed", result: { status: "blocked", reasonCode: "not_repository" } }] };
    store.markStepNeedsReview(created.task.id, "work", result.error, result);
    assert.deepEqual(store.getTask(created.task.id).steps[0].result, result);
    store.close();

    store = new SqliteTaskStore({ filename, maxConcurrent: 2 });
    const restored = store.getTask(created.task.id);
    assert.equal(restored.task.status, "needs_review");
    assert.deepEqual(restored.steps[0].result, result);
    assert.deepEqual(restored.attempts[0].result, result);
    assert.equal(restored.events.at(-1).reason, result.error);
    store.close();
  } finally {
    try { store?.close(); } catch { /* already closed before simulated restart */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("persists task-scoped MCP tool events durably", () => {
  const root = mkdtempSync(join(tmpdir(), "mao-hybrid-tool-events-"));
  const filename = join(root, "tasks.sqlite");
  let store;
  try {
    store = new SqliteTaskStore({ filename });
    store.registerProject({ id: "electronics", name: "Electronics", workspaceRoot: join(root, "workspace") });
    const created = store.createTaskPlan({ request: { projectId: "electronics", title: "Simulate a divider", brief: "Measure output" }, steps: [{ id: "work", title: "Simulate", prompt: "Use ngspice", roleId: "electronics-engineer", employeeId: "employee-001" }] });
    const payload = { executionId: `${created.task.id}:work:attempt:1`, data: { server: "mao_electronics", toolName: "electronics.ngspice.run", result: { status: "PASS", stdout: "v(out) = 5.000000e+00" } } };
    store.appendEvent(created.task.id, "tool.completed", payload);
    store.close();
    store = new SqliteTaskStore({ filename });
    assert.deepEqual(store.getTask(created.task.id).events.at(-1), { sequence: 2, type: "tool.completed", occurredAt: store.getTask(created.task.id).events.at(-1).occurredAt, ...payload });
    assert.throws(() => store.appendEvent(created.task.id, "../unsafe", payload), /identity is invalid/);
    assert.throws(() => store.appendEvent("missing-task", "tool.completed", payload), { code: "task_not_found" });
  } finally {
    try { store?.close(); } catch { /* closed before restart */ }
    rmSync(root, { recursive: true, force: true });
  }
});
