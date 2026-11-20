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

test("Director routes KiCad, ngspice, embedded firmware, and voltage-divider requests to electronics", () => {
  const { root, store } = temporaryStore();
  try {
    const company = createCompany({ store, runtime: { async execute() { return { status: "completed", text: "unused" }; } } });
    company.registerProject({ id: "electronics-routing", name: "Electronics", workspaceRoot: join(root, "workspace") });
    for (const [index, title] of [
      "Analyze an electronics voltage divider with ngspice",
      "Check an electronics circuit with KiCad ERC",
      "Build embedded Arduino firmware with PlatformIO",
      "Analyze a делитель напряжения",
    ].entries()) {
      const task = company.submitTask({ projectId: "electronics-routing", title, brief: "Use the appropriate engineering tool", complexity: "simple", idempotencyKey: `electronics-route-${index}` });
      assert.equal(task.directorPlan.specialistRoleId, "electronics-engineer", title);
      assert.equal(task.steps[0].roleId, "electronics-engineer", title);
    }
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("complex analysis and Python delivery routes Analyst, Developer, and QA with prerequisite handoffs", async () => {
  const { root, store } = temporaryStore();
  const dispatches = [];
  try {
    const roster = createDefaultRoster();
    const company = createCompany({
      store, roster,
      runtime: { async execute(input) {
        dispatches.push(input);
        const text = input.step.id === "analyze"
          ? "Analysis result: engineering.py exposes calculate_load(value)."
          : input.step.id === "specialist-work"
            ? "Developer result: engineering.py, pytest tests, and README were produced."
            : "QA review complete.";
        return { status: "completed", text };
      } },
    });
    company.registerProject({ id: "python-routing", name: "Python routing", workspaceRoot: join(root, "workspace") });
    const plan = company.submitTask({
      projectId: "python-routing",
      title: "Analyze requirements for a small engineering library",
      brief: "First analyze and document the requirements, then implement the design and finish with QA.",
      acceptanceCriteria: [
        "Implement the Python package module engineering.py with a stable public function.",
        "Add pytest tests and README.md documentation.",
        "Run the tests and have QA review the delivered package.",
      ],
      complexity: "complex",
      idempotencyKey: "complex-python-specialist-routing",
    });

    assert.equal(plan.directorPlan.specialistRoleId, "developer");
    assert.deepEqual(plan.steps.map(step => step.roleId), ["analyst", "developer", "qa-engineer"]);
    assert.deepEqual(plan.steps.map(step => step.dependsOn), [[], ["analyze"], ["specialist-work"]]);
    assert.equal(roster.employees.find(employee => employee.id === plan.steps[0].employeeId).professionId, "analyst");
    assert.equal(roster.employees.find(employee => employee.id === plan.steps[1].employeeId).professionId, "developer");
    assert.equal(roster.employees.find(employee => employee.id === plan.steps[2].employeeId).professionId, "qa-engineer");

    await company.runAvailable();
    const saved = company.getTask(plan.task.id);
    assert.equal(saved.task.status, "completed");
    assert.deepEqual(dispatches.map(input => input.step.id), ["analyze", "specialist-work", "review"]);
    assert.match(dispatches[1].step.prompt, /Analysis result: engineering\.py exposes calculate_load/);
    assert.match(dispatches[2].step.prompt, /Developer result: engineering\.py, pytest tests, and README were produced/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Director routes ESP32-C3 enclosure design to the CAD engineer", () => {
  const { root, store } = temporaryStore();
  try {
    const company = createCompany({ store, runtime: { async execute() { return { status: "completed", text: "unused" }; } } });
    company.registerProject({ id: "esp32-cad-routing", name: "ESP32 enclosure", workspaceRoot: join(root, "workspace") });
    const task = company.submitTask({ projectId: "esp32-cad-routing", title: "Design a CAD enclosure for ESP32-C3 SuperMini", brief: "Create a dimensioned parametric 3D housing with STEP and STL exports.", complexity: "simple", idempotencyKey: "esp32-cad-route" });
    assert.equal(task.directorPlan.specialistRoleId, "cad-engineer");
    assert.equal(task.steps[0].roleId, "cad-engineer");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
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

test("a dependent step receives the persisted predecessor result after restart", async () => {
  const { root, store } = temporaryStore();
  let activeStore = store;
  const dispatches = [];
  const runtime = {
    async execute(input) {
      dispatches.push(input);
      return { status: "completed", text: "Created greeting.py and verified the greet(name) contract." };
    },
    async inspect() { return { status: "unknown" }; },
  };
  try {
    const company = createCompany({ store: activeStore, runtime });
    company.registerProject({ id: "multi-step", name: "Multi-step", workspaceRoot: join(root, "workspace") });
    const accepted = company.submitTask({
      projectId: "multi-step", title: "Create a Python greeting package", brief: "Implement a small greeting module and then add tests and docs.",
      complexity: "standard", idempotencyKey: "persisted-handoff",
    });
    const analysis = activeStore.claimNext();
    assert.equal(analysis.step.id, "analyze");
    const predecessorResult = { status: "completed", text: "Create greeting.py with greet(name), returning a personalized greeting. Keep the public function signature greet(name)." };
    activeStore.markStepCompleted(accepted.task.id, "analyze", predecessorResult);
    activeStore.close();

    activeStore = new SqliteTaskStore({ filename: join(root, "tasks.sqlite"), maxConcurrent: 2 });
    const restarted = createCompany({ store: activeStore, runtime });
    await restarted.resume();

    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].step.id, "specialist-work");
    assert.match(dispatches[0].step.prompt, /persisted prerequisite output/i);
    assert.match(dispatches[0].step.prompt, /greet\(name\)/);
    assert.match(dispatches[0].step.prompt, /untrusted reference data/i);
    assert.equal(restarted.getTask(accepted.task.id).task.status, "completed");
    assert.deepEqual(restarted.getTask(accepted.task.id).steps[0].result, predecessorResult);
  } finally {
    try { activeStore.close(); } catch { /* store was closed before simulated restart */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed or needs_review prerequisites keep dependent steps queued", async () => {
  for (const outcome of [
    { result: { status: "failed", error: "analysis failed", safeToRetry: false }, taskStatus: "failed" },
    { result: { status: "needs_review", error: "analysis is ambiguous" }, taskStatus: "needs_review" },
  ]) {
    const { root, store } = temporaryStore();
    const dispatches = [];
    try {
      const company = createCompany({ store, runtime: { async execute(input) { dispatches.push(input.step.id); return outcome.result; } } });
      company.registerProject({ id: "blocked-dependency", name: "Blocked dependency", workspaceRoot: join(root, "workspace") });
      const accepted = company.submitTask({
        projectId: "blocked-dependency", title: "Plan then implement a Python module", brief: "First analyze requirements, then implement the module.",
        complexity: "standard", idempotencyKey: `blocked-${outcome.taskStatus}`,
      });
      await company.runAvailable();
      const saved = company.getTask(accepted.task.id);
      assert.deepEqual(dispatches, ["analyze"]);
      assert.equal(saved.task.status, outcome.taskStatus);
      assert.equal(saved.steps[0].status, outcome.taskStatus);
      assert.equal(saved.steps[1].status, "queued");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("stores tool-call evidence when Runtime returns needs_review", async () => {
  const { root, store } = temporaryStore();
  const result = { status: "needs_review", error: "mcp_tool_blocked:mao_coding/coding.git.status:not_repository", toolCalls: [{ id: "call-1", server: "mao_coding", toolId: "coding.git.status", status: "completed", result: { status: "blocked", reasonCode: "not_repository" } }] };
  try {
    const company = createCompany({ store, runtime: { async execute() { return result; } } });
    company.registerProject({ id: "plain-project", name: "Plain", workspaceRoot: join(root, "workspace") });
    const submitted = await company.submitAndRun({ projectId: "plain-project", title: "Read Git status", brief: "Call coding.git.status", complexity: "simple", idempotencyKey: "blocked-git-status" });
    assert.equal(submitted.task.status, "needs_review");
    assert.equal(submitted.steps[0].error, result.error);
    assert.deepEqual(submitted.steps[0].result, result);
    const persisted = company.getTask(submitted.task.id);
    assert.deepEqual(persisted.steps[0].result, result);
    assert.deepEqual(persisted.attempts[0].result, result);
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
