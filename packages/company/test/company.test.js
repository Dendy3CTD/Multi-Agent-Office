import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteTaskStore } from "../../task-store/src/index.js";
import { createCompany, createDefaultRoster } from "../src/index.js";

function temporaryStore() {
  const root = mkdtempSync(join(tmpdir(), "mao-hybrid-company-"));
  return { root, store: new SqliteTaskStore({ filename: join(root, "tasks.sqlite"), maxConcurrent: 2 }) };
}

test("keeps the 113-profile, 12-department roster and has runnable engineering specialists", () => {
  const roster = createDefaultRoster();
  assert.equal(roster.departments.length, 12);
  assert.equal(roster.employees.length, 113);
  for (const roleId of ["developer", "analyst", "electronics-engineer", "cad-engineer"]) {
    assert.ok(roster.professions.some((role) => role.id === roleId), `missing ${roleId} role`);
    assert.ok(roster.employees.some((employee) => employee.professionId === roleId), `missing ${roleId} employee`);
  }
  assert.ok(roster.professions.find((role) => role.id === "cad-engineer").skillTags.includes("3d"));
});

test("Director decomposes a complex request, routes to a specialist, and saves a successful runtime result", async () => {
  const { root, store } = temporaryStore();
  const dispatches = [];
  const runtime = {
    async execute(input) {
      dispatches.push(input);
      return { status: "completed", text: `done:${input.step.id}`, artifacts: [] };
    },
    async inspect() { return { status: "unknown" }; },
  };
  try {
    const company = createCompany({ store, runtime });
    const project = { id: "cad-project", name: "CAD Project", workspaceRoot: join(root, "workspace-cad") };
    company.registerProject(project);
    const accepted = company.submitTask({ projectId: project.id, title: "Design a 3D enclosure", brief: "Create a CAD enclosure and verify the clearances", complexity: "complex", idempotencyKey: "cad-task-1" });
    assert.equal(accepted.task.status, "queued");
    assert.equal(accepted.steps.length, 3);
    assert.ok(accepted.steps.some((step) => step.roleId === "cad-engineer"));
    assert.match(accepted.steps.find((step) => step.id === "analyze").prompt, /read-only/i);

    await company.runAvailable();
    const result = company.getTask(accepted.task.id);
    assert.equal(result.task.status, "completed");
    assert.equal(result.steps.length, 3);
    assert.equal(result.steps.every((step) => step.status === "completed"), true);
    assert.ok(dispatches.every((input) => input.project.id === project.id));
    assert.ok(dispatches.every((input) => input.employee.instructions && input.employee.skills.length));
    assert.ok(dispatches.every((input) => input.workingDirectory === project.workspaceRoot));
    assert.ok(dispatches.every((input) => input.memoryFile.startsWith(project.workspaceRoot)));
    assert.ok(dispatches.every((input) => input.executionId));
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("submitAndRun durably plans first and returns the runtime result", async () => {
  const { root, store } = temporaryStore();
  const runtime = { async execute(input) { return { status: "completed", text: `result for ${input.task.id}` }; } };
  try {
    const company = createCompany({ store, runtime });
    company.registerProject({ id: "project", name: "P", workspaceRoot: join(root, "project") });
    const result = await company.submitAndRun({ projectId: "project", title: "Implement a small API", brief: "Add one endpoint", complexity: "simple", idempotencyKey: "submit-and-run" });
    assert.equal(result.task.status, "completed");
    assert.equal(result.steps[0].status, "completed");
    assert.equal(result.steps[0].result.text, `result for ${result.task.id}`);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs no more than two workers and isolates a failed task from an independent project", async () => {
  const { root, store } = temporaryStore();
  let active = 0;
  let maximumActive = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runtime = {
    async execute(input) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await gate;
      active -= 1;
      if (input.task.title === "Fail this project") return { status: "failed", error: "specialist error", safeToRetry: false };
      return { status: "completed", text: "project result", artifacts: [] };
    },
    async inspect() { return { status: "unknown" }; },
  };
  try {
    const company = createCompany({ store, runtime, maxConcurrent: 2 });
    company.registerProject({ id: "project-a", name: "A", workspaceRoot: join(root, "a") });
    company.registerProject({ id: "project-b", name: "B", workspaceRoot: join(root, "b") });
    const bad = company.submitTask({ projectId: "project-a", title: "Fail this project", brief: "Programming task", complexity: "simple", idempotencyKey: "bad" });
    const good = company.submitTask({ projectId: "project-b", title: "Analyze this project", brief: "Analysis task", complexity: "simple", idempotencyKey: "good" });
    const running = company.runAvailable();
    while (active < 2) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(maximumActive, 2);
    release();
    await running;
    assert.equal(company.getTask(bad.task.id).task.status, "failed");
    assert.equal(company.getTask(good.task.id).task.status, "completed");
    assert.equal(maximumActive, 2);
  } finally {
    release?.();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("restart resumes queued work, while an unknown in-flight execution becomes needs_review without redispatch", async () => {
  const { root, store } = temporaryStore();
  let calls = 0;
  const runtime = {
    async execute() { calls += 1; return { status: "completed", text: "done", artifacts: [] }; },
    async inspect() { return { status: "unknown" }; },
  };
  try {
    const company = createCompany({ store, runtime });
    company.registerProject({ id: "project", name: "P", workspaceRoot: join(root, "project") });
    const queued = company.submitTask({ projectId: "project", title: "Code a small feature", brief: "Add a function", complexity: "simple", idempotencyKey: "queued" });
    store.close();

    let restartedStore = new SqliteTaskStore({ filename: join(root, "tasks.sqlite"), maxConcurrent: 2 });
    let restarted = createCompany({ store: restartedStore, runtime });
    await restarted.resume();
    assert.equal(restarted.getTask(queued.task.id).task.status, "completed");
    assert.equal(calls, 1);

    const uncertain = restarted.submitTask({ projectId: "project", title: "Build 3D design", brief: "Create a model", complexity: "simple", idempotencyKey: "uncertain" });
    const claimed = restartedStore.claimNext();
    assert.equal(claimed.task.id, uncertain.task.id);
    restartedStore.close();

    restartedStore = new SqliteTaskStore({ filename: join(root, "tasks.sqlite"), maxConcurrent: 2 });
    restarted = createCompany({ store: restartedStore, runtime });
    await restarted.resume();
    assert.equal(restarted.getTask(uncertain.task.id).task.status, "needs_review");
    assert.equal(calls, 1);
    restartedStore.close();
  } finally {
    try { store.close(); } catch { /* store was closed before simulated restart */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("retries one analysis step only after the runtime confirms safe termination", async () => {
  const { root, store } = temporaryStore();
  const seenIds = [];
  let first = true;
  const runtime = {
    async execute(input) {
      seenIds.push(input.executionId);
      if (first) {
        first = false;
        return { status: "failed", error: "temporary runtime error", executionState: "terminated", safeToRetry: true };
      }
      return { status: "completed", text: "analyzed" };
    },
    async inspect() { return { status: "unknown" }; },
  };
  try {
    const company = createCompany({ store, runtime });
    company.registerProject({ id: "project", name: "P", workspaceRoot: join(root, "project") });
    const accepted = company.submitTask({ projectId: "project", title: "Analyze requirements", brief: "Research a small feature", complexity: "standard", idempotencyKey: "safe-retry" });
    await company.runAvailable();
    const result = company.getTask(accepted.task.id);
    assert.equal(result.task.status, "completed");
    assert.equal(seenIds.length, 3);
    assert.equal(seenIds[0], `${accepted.task.id}:analyze:attempt:1`);
    assert.equal(seenIds[1], `${accepted.task.id}:analyze:attempt:2`);
    assert.notEqual(seenIds[0], seenIds[1]);
    assert.match(seenIds[2], /specialist-work:attempt:1$/);
    assert.equal(result.attempts.filter((attempt) => attempt.stepId === "analyze").length, 2);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
