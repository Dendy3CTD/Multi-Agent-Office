import { describe, expect, it } from "vitest";
import { BudgetManager, type CashPaymentStore, type UsageRecord, type UsageStore } from "@open-agent-office/budget-manager";
import { seedDirectory } from "../../directory/src/index.js";
import type { ModelSelection, Profession, RuntimeAdapter, RuntimeCapabilities, RuntimeEvent, RuntimeTask, RuntimeExecutionCallbacks, UsageMetrics } from "@open-agent-office/shared";
import { ExecutionCoordinator, ExecutionCoordinatorError, type ExecutionCoordinatorOptions, type ExecutionEmployeeProfile, type ExecutionModelGatewayPort } from "../src/execution-coordinator.js";
import { ProjectPortfolio } from "../src/portfolio-manager.js";
import { ResourceAllocator, type DirectoryEmployeeSnapshot } from "../src/resource-allocator.js";
import { RuntimeManager } from "../src/runtime-manager.js";
import { TaskScheduler } from "../src/scheduler.js";

const paymentStore = (): CashPaymentStore => ({ appendPayment: async () => true, readPayments: async () => [] });
const caps: RuntimeCapabilities = { runtimeId: "fake", runtimeType: "opencode", supportedProviders: ["fake"], supportedModels: ["fake/model"], session: false, cancel: true, usage: true };
const project = (id: string, max = 2) => ({ id, name: id, rootDir: `/tmp/${id}`, status: "active" as const, portfolio: { priority: "normal" as const, budgetShare: 0.2, maxConcurrentExecutions: max } });

/** Deferred, cancellable runtime for deterministic lifecycle races. */
class InstrumentedRuntime implements RuntimeAdapter {
  readonly id = "fake";
  readonly calls: RuntimeTask[] = [];
  private readonly deferred = new Map<string, (settlement: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } }) => void>();
  private readonly callbacks = new Map<string, RuntimeExecutionCallbacks>();
  /** When set, executions settle on their own after one microtask. */
  autoSettle?: { result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] }; reject?: Error };
  readonly capabilities = () => caps;
  execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks = {}): Promise<{ runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] }> {
    this.calls.push(task);
    this.callbacks.set(String(task.executionId), callbacks);
    return new Promise((resolve, reject) => {
      const settle = (settlement: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } }) => { task.signal?.removeEventListener("abort", onAbort); if (settlement.reject) reject(settlement.reject); else resolve(settlement.result ?? { runtimeId: "fake", text: "completed", events: [] }); };
      const onAbort = () => settle({ reject: new Error("synthetic abort") });
      task.signal?.addEventListener("abort", onAbort, { once: true });
      this.deferred.set(String(task.executionId), settle);
      const pending = this.autoSettle;
      if (pending) queueMicrotask(() => this.settle(String(task.executionId), { result: pending.result, reject: pending.reject }));
    });
  }
  settle(executionId: string, settlement: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } }): void { this.deferred.get(executionId)?.(settlement); }
  emitUsage(executionId: string, usage: UsageMetrics): void { this.callbacks.get(executionId)?.onUsage?.(usage, { type: "usage", runtimeId: "fake", payload: {} }); }
}

interface Harness { coordinator: ExecutionCoordinator; runtime: InstrumentedRuntime; scheduler: TaskScheduler; budget: BudgetManager; portfolio: ProjectPortfolio }
type HarnessOptions = Partial<Pick<ExecutionCoordinatorOptions, "onEvent">> & { policy?: Record<string, unknown>; employeeCount?: number; projects?: string[]; maxPerProject?: number };
function makeCoordinator(options: HarnessOptions = {}): Harness {
  const { policy, employeeCount = 1, projects = ["p1", "p2"], maxPerProject = 2 } = options;
  const directory = seedDirectory();
  const portfolio = new ProjectPortfolio();
  for (const id of projects) portfolio.register(project(id, maxPerProject));
  const profession: Profession = directory.professions.get("director");
  const employees: DirectoryEmployeeSnapshot[] = Array.from({ length: employeeCount }, (_, index) => ({ id: `employee-${String(index + 1).padStart(3, "0")}`, departmentId: profession.departmentId, professionId: profession.id, status: "active" as const, availableSkillIds: [], capabilityRequirements: profession.capabilityRequirements }));
  const allocator = new ResourceAllocator(employees, portfolio);
  const scheduler = new TaskScheduler(portfolio, allocator);
  const runtime = new InstrumentedRuntime();
  const runtimeManager = new RuntimeManager();
  runtimeManager.register(runtime);
  const budget = new BudgetManager({ appendUsage: async () => true, readUsage: async () => [] }, { paymentStore: paymentStore(), policy: (policy ? { monthlyBudgetRub: 2000, subscriptionCostRub: null, ...policy } : { monthlyBudgetRub: 2000, subscriptionCostRub: null }) as never });
  const selection: ModelSelection = { modelId: "fake/model", runtimeId: "fake", provider: "fake", expenseCategory: "free", rationale: "synthetic", fallbacks: [] };
  const gateway: ExecutionModelGatewayPort = { select: () => selection };
  const profile: ExecutionEmployeeProfile = { employeeId: "employee-001", profession, modelDefault: "fake/model" };
  const coordinator = new ExecutionCoordinator({ portfolio, allocator, scheduler, budget, runtimeManager, directory: { getEmployeeProfile: () => profile }, gateway, onEvent: options.onEvent });
  return { coordinator, runtime, scheduler, budget, portfolio };
}
const request = (taskId: string, projectId = "p1", employeeId = "employee-001") => ({ taskId, projectId, employeeId, title: taskId, prompt: "Prompt with secret marker TOPSECRET-42.", cwd: "/tmp/project", complexity: "simple" as const, estimatedInputTokens: 2, estimatedOutputTokens: 3, maxAttempts: 1 });
type CoordinatorRequest = Parameters<ExecutionCoordinator["dispatch"]>[0];

/** Budget whose first journal read hangs until the test releases the gate. */
function gateBudget(): BudgetManager & { release(): void } {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  const store: UsageStore = { appendUsage: async () => true, readUsage: async () => { reads += 1; if (reads === 1) await gate; return [] as UsageRecord[]; } };
  const budget = new BudgetManager(store, { paymentStore: paymentStore(), policy: { monthlyBudgetRub: 2000, subscriptionCostRub: null } });
  return Object.assign(budget, { release, reads: () => reads });
}

function coordinatorWith(custom: { budget?: BudgetManager; projects?: string[] }): Harness {
  const directory = seedDirectory();
  const portfolio = new ProjectPortfolio();
  for (const id of custom.projects ?? ["p1"]) portfolio.register(project(id, 2));
  const profession = directory.professions.get("director");
  const runtime = new InstrumentedRuntime();
  const rm = new RuntimeManager(); rm.register(runtime);
  const allocator = new ResourceAllocator([{ id: "employee-001", departmentId: profession.departmentId, professionId: profession.id, status: "active", availableSkillIds: [], capabilityRequirements: ["reasoning"] }], portfolio);
  const scheduler = new TaskScheduler(portfolio, allocator);
  const budget = custom.budget ?? new BudgetManager({ appendUsage: async () => true, readUsage: async () => [] }, { paymentStore: paymentStore(), policy: { monthlyBudgetRub: 2000, subscriptionCostRub: null } });
  const gateway: ExecutionModelGatewayPort = { select: () => ({ modelId: "fake/model", runtimeId: "fake", provider: "fake", expenseCategory: "free", rationale: "r", fallbacks: [] }) };
  const coordinator = new ExecutionCoordinator({
    portfolio, allocator, scheduler, budget, runtimeManager: rm,
    directory: { getEmployeeProfile: () => ({ employeeId: "employee-001", profession, modelDefault: "fake/model" }) as ExecutionEmployeeProfile },
    gateway,
  });
  return { coordinator, runtime, scheduler, budget, portfolio };
}

describe("S2-9 coordinator hardening", () => {
  it("cancel while the budget admission is pending never starts the runtime and frees the slot", async () => {
    const gated = gateBudget();
    const { coordinator, runtime, scheduler } = coordinatorWith({ budget: gated, projects: ["hold-cancel"] });
    const promise = coordinator.dispatch(request("hold-cancel-task", "hold-cancel"));
    await new Promise(resolve => setTimeout(resolve, 0));
    coordinator.cancel("hold-cancel-task");
    gated.release();
    const outcome = await promise;
    expect(outcome.phase).toBe("cancelled");
    expect(runtime.calls).toHaveLength(0);
    expect((await gated.getSnapshot()).activeTaskCount).toBe(0);
    expect(scheduler.pending()).toHaveLength(0);
    expect(coordinator.listEvents().some(x => x.type === "task_cancelled" && x.taskId === "hold-cancel-task")).toBe(true);
  });

  it("cancel between retry attempts stops the retry loop without more attempts", async () => {
    const { coordinator, runtime, budget } = makeCoordinator({ employeeCount: 1 });
    const originalStart = budget.startTask.bind(budget);
    let admissions = 0;
    let gate!: () => void;
    const secondAdmission = new Promise<void>(resolve => { gate = resolve; });
    (budget as unknown as { startTask: BudgetManager["startTask"] }).startTask = (input) => { admissions += 1; if (admissions === 2) return secondAdmission.then(() => originalStart(input)); return originalStart(input); };
    runtime.autoSettle = { reject: new Error("attempt 1 fails") };
    const promise = coordinator.dispatch({ ...request("retry-cancel-task"), maxAttempts: 3 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(runtime.calls).toHaveLength(1);
    coordinator.cancel("retry-cancel-task");
    gate();
    const outcome = await promise;
    expect(outcome.phase).toBe("cancelled");
    expect(runtime.calls).toHaveLength(1);
    expect(admissions).toBe(2);
  });

  it("a runtime that settles late after cancel is reported cancelled, not completed", async () => {
    const { coordinator, runtime, budget, scheduler } = makeCoordinator();
    const promise = coordinator.dispatch(request("late-settle"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(coordinator.cancel("late-settle")).toBe(true);
    runtime.settle("late-settle:attempt:1", { result: { runtimeId: "fake", text: "worked anyway", events: [] } });
    const outcome = await promise;
    expect(outcome.phase).toBe("cancelled");
    expect(coordinator.snapshot("late-settle")?.phase).toBe("cancelled");
    expect(coordinator.listEvents().filter(x => x.taskId === "late-settle").map(x => x.type)).toContain("task_cancelled");
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
    expect(scheduler.pending()).toHaveLength(0);
    expect(runtime.calls).toHaveLength(1);
  });

  it("usage recording failure does not release the admission slot mid-run", async () => {
    const failingStore: UsageStore = { appendUsage: async () => { throw new Error("journal outage"); }, readUsage: async () => [] };
    const budget = new BudgetManager(failingStore, { paymentStore: paymentStore(), policy: { monthlyBudgetRub: 2000, subscriptionCostRub: null } });
    const { coordinator, runtime } = coordinatorWith({ budget, projects: ["usage-p"] });
    const promise = coordinator.dispatch(request("usage-fail", "usage-p"));
    await new Promise(resolve => setTimeout(resolve, 0));
    runtime.emitUsage("usage-fail:attempt:1", { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2, costUsd: 0 });
    runtime.settle("usage-fail:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    const outcome = await promise;
    expect(outcome.phase).toBe("completed");
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("budget duration abort propagates into the runtime signal and cleans up", async () => {
    const { coordinator, runtime, budget, scheduler } = makeCoordinator({ policy: { maxTaskDurationMs: 40 }, maxPerProject: 1, projects: ["timeout-p"] });
    const promise = coordinator.dispatch({ ...request("timeout-task", "timeout-p"), maxAttempts: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(runtime.calls).toHaveLength(1);
    const outcome = await promise;
    expect(["failed", "cancelled"]).toContain(outcome.phase);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
    expect(scheduler.pending()).toHaveLength(0);
  });

  it("one admission per attempt with distinct accounting ids and no duplicated usage events", async () => {
    const records: UsageRecord[] = [];
    const store: UsageStore = { appendUsage: async record => { if (records.some(x => x.eventId === record.eventId)) return false; records.push(structuredClone(record)); return true; }, readUsage: async () => structuredClone(records) };
    const budget = new BudgetManager(store, { paymentStore: paymentStore(), policy: { monthlyBudgetRub: 2000, subscriptionCostRub: null } });
    const { coordinator, runtime } = coordinatorWith({ budget, projects: ["retry-p"] });
    const promise = coordinator.dispatch({ ...request("retry-task", "retry-p"), maxAttempts: 3 });
    await new Promise(resolve => setTimeout(resolve, 0));
    runtime.settle("retry-task:attempt:1", { reject: new Error("retry me") });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(runtime.calls.map(x => String(x.executionId))).toEqual(["retry-task:attempt:1", "retry-task:attempt:2"]);
    runtime.emitUsage("retry-task:attempt:2", { input: 3, output: 4, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 7, costUsd: 0 });
    runtime.settle("retry-task:attempt:2", { result: { runtimeId: "fake", text: "ok", events: [] } });
    const outcome = await promise;
    expect(outcome.phase).toBe("completed");
    const events = coordinator.listEvents();
    expect(events.filter(x => x.type === "model_escalated")).toHaveLength(0);
    expect((await budget.getUsageSummary()).eventCount).toBe(1);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("budget refusal with an active runtime blocks the second task without stopping the first", async () => {
    const { coordinator, runtime, budget } = makeCoordinator({ policy: { maxConcurrentTasks: 1 }, employeeCount: 2, maxPerProject: 2 });
    const first = coordinator.dispatch(request("holder"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(runtime.calls).toHaveLength(1);
    const second = await coordinator.dispatch({ ...request("blocked-second", "p1", "employee-002"), estimatedCostUsd: 1 });
    expect(second.phase).toBe("failed");
    expect(coordinator.listEvents().some(x => x.type === "budget_blocked" && x.taskId === "blocked-second")).toBe(true);
    expect(runtime.calls).toHaveLength(1);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(1);
    coordinator.cancel("holder");
    runtime.settle("holder:attempt:1", { reject: new Error("stopped") });
    await first;
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("never runs an unapproved paid selection and refuses unknown providers (budget admission fails closed)", async () => {
    const failingBudget = new BudgetManager({ appendUsage: async () => true, readUsage: async () => [] }, { paymentStore: paymentStore(), policy: { monthlyBudgetRub: 2000, subscriptionCostRub: 1500, maxReportedCostUsdPerTask: 0.001 } });
    const { coordinator, runtime } = coordinatorWith({ budget: failingBudget, projects: ["paid-p"] });
    const outcome = await coordinator.dispatch({ ...request("paid-task", "paid-p"), estimatedCostUsd: 2, maxAttempts: 1 });
    expect(["failed", "queued"]).toContain(outcome.phase);
    expect(runtime.calls).toHaveLength(0);
    expect(coordinator.listEvents().some(x => x.type === "budget_blocked" || x.type === "task_failed")).toBe(true);
  });

  it("coordinator events never leak prompts or submitted credentials", async () => {
    const harness = makeCoordinator();
    harness.runtime.autoSettle = { result: { runtimeId: "fake", text: "auto", events: [] } };
    await harness.coordinator.dispatch(request("secret-event", "p2"));
    expect(JSON.stringify(harness.coordinator.listEvents())).not.toContain("TOPSECRET-42");
  });

  it("concurrent dispatch storm over one employee keeps exactly one running execution", async () => {
    const { coordinator, runtime } = makeCoordinator({ employeeCount: 1 });
    runtime.autoSettle = { result: { runtimeId: "fake", text: "auto", events: [] } };
    const dispatched = [1, 2, 3, 4].map(index => coordinator.dispatch(request(`storm-${index}`, "p1")));
    const phases = await Promise.all(dispatched.map(promise => promise.then(o => o.snapshot.phase)));
    expect(phases.filter(x => x === "completed")).toHaveLength(1);
    expect(phases.filter(x => x === "queued")).toHaveLength(3);
    expect(runtime.calls).toHaveLength(1);
    expect(new Set(runtime.calls.map(x => String(x.executionId))).size).toBe(1);
  });

  it("two employees finish two tasks of one project without cross-release", async () => {
    const { coordinator, runtime } = makeCoordinator({ employeeCount: 2, maxPerProject: 2 });
    runtime.autoSettle = { result: { runtimeId: "fake", text: "auto", events: [] } };
    const [o1, o2] = await Promise.all([coordinator.dispatch(request("duo-1", "p1", "employee-001")), coordinator.dispatch(request("duo-2", "p1", "employee-002"))]);
    expect([o1.snapshot.phase, o2.snapshot.phase]).toEqual(["completed", "completed"]);
    expect(runtime.calls).toHaveLength(2);
    expect(new Set(runtime.calls.map(x => String(x.executionId)).values()).size).toBe(2);
  });

  it("five projects keep task identities isolated end-to-end", async () => {
    const projects = ["proj-a", "proj-b", "proj-c", "proj-d", "proj-e"];
    const five = makeCoordinator({ employeeCount: 5, projects, maxPerProject: 1 });
    five.runtime.autoSettle = { result: { runtimeId: "fake", text: "auto", events: [] } };
    const outcomes = await Promise.all(projects.map((projectId, index) => five.coordinator.dispatch(request(`${projectId}-task`, projectId, `employee-${String(index + 1).padStart(3, "0")}`))));
    for (const [index, outcome] of outcomes.entries()) {
      expect(outcome.phase).toBe("completed");
      expect(outcome.snapshot.projectId).toBe(projects[index]);
    }
    const events = five.coordinator.listEvents();
    for (const projectId of projects) expect(events.filter(x => x.taskId === `${projectId}-task`).every(x => x.projectId === projectId)).toBe(true);
  });

  it("duplicate dispatch after completion replays the stored outcome without executing again", async () => {
    const { coordinator, runtime } = makeCoordinator();
    runtime.autoSettle = { result: { runtimeId: "fake", text: "once", events: [] } };
    const first = await coordinator.dispatch(request("replay"));
    await expect(coordinator.dispatch(request("replay"))).resolves.toEqual(first);
    expect(runtime.calls).toHaveLength(1);
  });

  it("rejects malformed requests without touching the scheduler", async () => {
    const { coordinator, scheduler } = makeCoordinator();
    const bad: readonly CoordinatorRequest[] = [
      { ...request("bad-id!"), projectId: "p1" } as CoordinatorRequest,
      { ...request("ok"), projectId: "bad/project" } as CoordinatorRequest,
      { ...request("ok"), prompt: "   " } as CoordinatorRequest,
      { ...request("ok"), estimatedInputTokens: Number.NaN } as CoordinatorRequest,
      { ...request("ok"), estimatedOutputTokens: -2 } as CoordinatorRequest,
      { ...request("ok"), estimatedCostUsd: Number.POSITIVE_INFINITY } as CoordinatorRequest,
    ];
    for (const candidate of bad) {
      try {
        coordinator.dispatch(candidate);
        throw new Error("expected invalid request rejection");
      } catch (caught) {
        expect(caught).toBeInstanceOf(ExecutionCoordinatorError);
      }
    }
    expect(scheduler.pending()).toHaveLength(0);
  });

  it("unresolved skills keep the task queued instead of admitting a no-skill execution", async () => {
    const { coordinator, runtime, scheduler } = makeCoordinator();
    const outcome = await coordinator.dispatch({ ...request("skillless"), requiredSkills: ["ghost-skill"] });
    expect(outcome.phase).toBe("queued");
    expect(runtime.calls).toHaveLength(0);
    expect(scheduler.pending()).toHaveLength(1);
    expect(scheduler.cancel("skillless")).toBe(true);
  });
});
