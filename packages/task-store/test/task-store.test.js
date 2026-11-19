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
