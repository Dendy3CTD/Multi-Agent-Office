import { describe, expect, it } from "vitest";
import { BudgetManager, type CashPaymentStore } from "@open-agent-office/budget-manager";
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
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

class PumpRuntime implements RuntimeAdapter {
  readonly id = "fake";
  readonly calls: RuntimeTask[] = [];
  private readonly deferred = new Map<string, (settlement: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } }) => void>();
  private readonly callbacks = new Map<string, RuntimeExecutionCallbacks>();
  failOnAttempt = 0;
  autoSettle: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } } | undefined = { result: { runtimeId: "fake", text: "auto", events: [] } };
  readonly capabilities = () => caps;
  execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks = {}): Promise<{ runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] }> {
    this.calls.push(task);
    this.callbacks.set(String(task.executionId), callbacks);
    return new Promise((resolve, reject) => {
      const settle = (settlement: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } }) => { task.signal?.removeEventListener("abort", onAbort); if (settlement.reject) reject(settlement.reject); else resolve(settlement.result ?? { runtimeId: "fake", text: "completed", events: [] }); };
      const onAbort = () => settle({ reject: new Error("abort") });
      task.signal?.addEventListener("abort", onAbort, { once: true });
      this.deferred.set(String(task.executionId), settle);
      const plan = this.autoSettle;
      const rejection: Error | undefined = plan?.reject;
      if (plan) queueMicrotask(() => this.settle(String(task.executionId), task.attempt === this.failOnAttempt ? { reject: rejection ?? new Error("planned failure") } : { result: plan.result ?? { runtimeId: "fake", text: "auto", events: [] } }));
    });
  }
  settle(executionId: string, settlement: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } }): void { this.deferred.get(executionId)?.(settlement); }
  emitUsage(executionId: string, usage: UsageMetrics): void { this.callbacks.get(executionId)?.onUsage?.(usage, { type: "usage", runtimeId: "fake", payload: {} }); }
}

interface Harness { coordinator: ExecutionCoordinator; runtime: PumpRuntime; scheduler: TaskScheduler; budget: BudgetManager; portfolio: ProjectPortfolio }

function makeCoordinator(options: Omit<Partial<ExecutionCoordinatorOptions>, "portfolio" | "allocator" | "scheduler" | "budget" | "runtimeManager" | "directory" | "gateway"> & { employeeCount?: number; projects?: string[]; maxPerProject?: number; failOnAttempt?: number; autoSettle?: boolean; policy?: Record<string, unknown>; runtime?: PumpRuntime } = {}): Harness {
  const { employeeCount = 1, projects = ["p1", "p2"], maxPerProject = 2, failOnAttempt = 0, autoSettle = true, policy, runtime: injectedRuntime } = options;
  const directory = seedDirectory();
  const portfolio = new ProjectPortfolio();
  for (const id of projects) portfolio.register(project(id, maxPerProject));
  const profession: Profession = directory.professions.get("director");
  const employees: DirectoryEmployeeSnapshot[] = Array.from({ length: employeeCount }, (_, index) => ({ id: `employee-${String(index + 1).padStart(3, "0")}`, departmentId: profession.departmentId, professionId: profession.id, status: "active" as const, availableSkillIds: [], capabilityRequirements: profession.capabilityRequirements }));
  const allocator = new ResourceAllocator(employees, portfolio);
  const scheduler = new TaskScheduler(portfolio, allocator);
  const runtime = injectedRuntime ?? new PumpRuntime();
  runtime.failOnAttempt = failOnAttempt;
  runtime.autoSettle = autoSettle ? { result: { runtimeId: "fake", text: "auto", events: [] } } : undefined;
  const runtimeManager = new RuntimeManager();
  runtimeManager.register(runtime);
  const budget = new BudgetManager({ appendUsage: async () => true, readUsage: async () => [] }, { paymentStore: paymentStore(), policy: (policy ? { monthlyBudgetRub: 2000, subscriptionCostRub: null, ...policy } : { monthlyBudgetRub: 2000, subscriptionCostRub: null }) as never });
  const selection: ModelSelection = { modelId: "fake/model", runtimeId: "fake", provider: "fake", expenseCategory: "free", rationale: "synthetic", fallbacks: [] };
  const gateway: ExecutionModelGatewayPort = { select: () => selection };
  const profile: ExecutionEmployeeProfile = { employeeId: "employee-001", profession, modelDefault: "fake/model" };
  const coordinator = new ExecutionCoordinator({ portfolio, allocator, scheduler, budget, runtimeManager, directory: { getEmployeeProfile: () => profile }, gateway });
  return { coordinator, runtime, scheduler, budget, portfolio };
}
const request = (taskId: string, projectId = "p1", employeeId = "employee-001") => ({ taskId, projectId, employeeId, title: taskId, prompt: "queued-pump prompt", cwd: "/tmp/project", complexity: "simple" as const, estimatedInputTokens: 2, estimatedOutputTokens: 3, maxAttempts: 1 });

describe("S2-10 queue pump", () => {
  it("one employee, two tasks: the queued task runs automatically after the first completes", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["solo-p"] });
    const first = harness.coordinator.dispatch(request("task-1", "solo-p"));
    const second = harness.coordinator.dispatch(request("task-2", "solo-p"));
    // While task-1 holds the only employee, task-2 is waiting — synchronously after dispatch.
    expect(harness.coordinator.listWaiting().map(x => x.taskId)).toEqual(["task-2"]);
    await expect(first).resolves.toMatchObject({ phase: "completed" });
    await expect(harness.coordinator.completion("task-2")).resolves.toMatchObject({ phase: "completed" });
    await expect(second).resolves.toMatchObject({ phase: "queued" });
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
    expect(harness.runtime.calls.map(call => String(call.executionId))).toEqual(["task-1:attempt:1", "task-2:attempt:1"]);
  });

  it("one employee, five tasks run strictly sequentially with FIFO order", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["fifo-p"] });
    for (const index of [1, 2, 3, 4, 5]) void harness.coordinator.dispatch(request(`fifo-${index}`, "fifo-p"));
    const completions = await Promise.all([1, 2, 3, 4, 5].map(index => harness.coordinator.completion(`fifo-${index}`).then(o => o.snapshot.phase)));
    expect(completions.filter(x => x === "completed")).toHaveLength(5);
    expect(harness.runtime.calls.map(call => String(call.executionId))).toEqual(["fifo-1:attempt:1", "fifo-2:attempt:1", "fifo-3:attempt:1", "fifo-4:attempt:1", "fifo-5:attempt:1"]);
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
  });

  it("five projects with one employee keep distinct project identities", async () => {
    const projects = ["proj-a", "proj-b", "proj-c", "proj-d", "proj-e"];
    const harness = makeCoordinator({ employeeCount: 1, projects, maxPerProject: 1 });
    for (const projectId of projects) void harness.coordinator.dispatch(request(`${projectId}-task`, projectId, "employee-001"));
    const completions = await Promise.all(projects.map(projectId => harness.coordinator.completion(`${projectId}-task`)));
    for (const [index, outcome] of completions.entries()) expect(outcome.snapshot.projectId).toBe(projects[index]);
    expect(new Set(harness.runtime.calls.map(call => String(call.executionId))).size).toBe(5);
  });

  it("two employees, five tasks: both employees pipeline through the pump", async () => {
    const harness = makeCoordinator({ employeeCount: 2, maxPerProject: 5, projects: ["two-p"] });
    for (const index of [1, 2, 3, 4, 5]) void harness.coordinator.dispatch(request(`two-${index}`, "two-p", index % 2 ? "employee-001" : "employee-002"));
    const completions = await Promise.all([1, 2, 3, 4, 5].map(index => harness.coordinator.completion(`two-${index}`)));
    expect(completions.every(o => o.snapshot.phase === "completed")).toBe(true);
    expect(new Set(harness.runtime.calls.map(call => String(call.executionId))).size).toBe(5);
  });

  it("concurrent pump calls coalesce without duplicate dispatch", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["co-p"] });
    const running = harness.coordinator.dispatch(request("co-1", "co-p"));
    void harness.coordinator.dispatch(request("co-2", "co-p"));
    expect(harness.coordinator.listWaiting().length).toBe(1);
    for (let index = 0; index < 50; index += 1) harness.coordinator.pump();
    await running;
    await harness.coordinator.completion("co-2");
    expect(harness.runtime.calls.filter(call => String(call.executionId).startsWith("co-2")).length).toBe(1);
  });

  it("pump during an active execution does not touch the running employee", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["race-p"], autoSettle: false });
    const running = harness.coordinator.dispatch(request("active", "race-p"));
    await flush();
    expect(harness.runtime.calls).toHaveLength(1);
    harness.coordinator.pump();
    harness.coordinator.pump();
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
    harness.runtime.settle("active:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    expect((await running).snapshot.phase).toBe("completed");
  });

  it("duplicate taskId dispatch replays without a second execution", async () => {
    const harness = makeCoordinator({ employeeCount: 1, projects: ["dup-p"] });
    const first = await harness.coordinator.dispatch(request("once", "dup-p"));
    await expect(harness.coordinator.dispatch(request("once", "dup-p"))).resolves.toEqual(first);
    expect(harness.runtime.calls).toHaveLength(1);
  });

  it("budget rejection fails the task and does not loop the pump", async () => {
    const harness = makeCoordinator({ employeeCount: 1, projects: ["budget-blocked-p"], policy: { maxReportedCostUsdPerTask: 0.001 }, autoSettle: false });
    const outcome = await harness.coordinator.dispatch({ ...request("blocked", "budget-blocked-p"), estimatedCostUsd: 2 });
    expect(outcome.phase).toBe("failed");
    await flush();
    expect(harness.runtime.calls).toHaveLength(0);
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
    expect(harness.coordinator.listEvents().filter(x => x.type === "budget_blocked")).toHaveLength(1);
  });

  it("queued cancellation wins over a later pump and never runs", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["cancel-p"] });
    const holder = harness.coordinator.dispatch(request("holder", "cancel-p"));
    void harness.coordinator.dispatch(request("to-cancel", "cancel-p"));
    expect(harness.coordinator.listWaiting().map(x => x.taskId)).toEqual(["to-cancel"]);
    expect(harness.coordinator.cancel("to-cancel")).toBe(true);
    expect(harness.coordinator.cancel("to-cancel")).toBe(false);
    await expect(harness.coordinator.completion("to-cancel")).resolves.toMatchObject({ phase: "cancelled" });
    harness.coordinator.pump();
    await flush();
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
    harness.runtime.settle("holder:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    await expect(holder).resolves.toMatchObject({ phase: "completed" });
    expect(harness.runtime.calls.map(call => String(call.executionId))).toEqual(["holder:attempt:1"]);
  });

  it("runtime availability changes drive pump promotion through explicit pump", async () => {
    const directory = seedDirectory();
    const portfolio = new ProjectPortfolio();
    portfolio.register(project("rt-p", 2));
    const profession = directory.professions.get("director");
    const runtime = new PumpRuntime();
    const rm = new RuntimeManager();
    const alloc = new ResourceAllocator([{ id: "employee-001", departmentId: profession.departmentId, professionId: profession.id, status: "active", availableSkillIds: [], capabilityRequirements: [] }], portfolio);
    const sched = new TaskScheduler(portfolio, alloc);
    const budget = new BudgetManager({ appendUsage: async () => true, readUsage: async () => [] }, { paymentStore: paymentStore(), policy: { monthlyBudgetRub: 2000, subscriptionCostRub: null } });
    const availabilityAwareGateway: ExecutionModelGatewayPort = { select: input => { if (input.runtimes.length === 0 || !input.runtimes.some(r => r.runtimeId === "fake")) throw new ExecutionCoordinatorError("resource_unavailable" as never, "no runtime is available yet"); return { modelId: "fake/model", runtimeId: "fake", provider: "fake", expenseCategory: "free", rationale: "r", fallbacks: [] }; } };
    const coordinator = new ExecutionCoordinator({ portfolio, allocator: alloc, scheduler: sched, budget, runtimeManager: rm, directory: { getEmployeeProfile: () => ({ employeeId: "employee-001", profession, modelDefault: "fake/model" }) }, gateway: availabilityAwareGateway });
    const held = coordinator.dispatch(request("needs-runtime", "rt-p"));
    await expect(held).resolves.toMatchObject({ phase: "queued" });
    expect(coordinator.listWaiting().map(x => x.taskId)).toEqual(["needs-runtime"]);
    // Before any pump trigger nothing new happened:
    expect(runtime.calls).toHaveLength(0);
    // The runtime becomes available and the caller (Server) signals the availability.
    rm.register(runtime);
    coordinator.pump();
    await expect(coordinator.completion("needs-runtime")).resolves.toMatchObject({ phase: "completed" });
    expect(runtime.calls).toHaveLength(1);
  });

  it("retry of a failed runtime execution stays distinct from queue re-promotion", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["retry-vs-requeue"], failOnAttempt: 1 });
    const outcome = await harness.coordinator.dispatch({ ...request("retry-task", "retry-vs-requeue"), maxAttempts: 2 });
    expect(outcome.snapshot.phase).toBe("completed");
    expect(runtimeExecutions(harness.runtime)).toEqual(["retry-task:attempt:1", "retry-task:attempt:2"]);
    expect(harness.scheduler.pending()).toHaveLength(0);
    expect((await harness.budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("project quota is respected by the pump (one slot per round)", async () => {
    const harness = makeCoordinator({ employeeCount: 3, maxPerProject: 1, projects: ["quota-p"] });
    for (const index of [1, 2, 3]) void harness.coordinator.dispatch(request(`quota-${index}`, "quota-p", `employee-00${index}`));
    await Promise.all([1, 2, 3].map(index => harness.coordinator.completion(`quota-${index}`).then(o => expect(o.snapshot.phase).toBe("completed"))));
    expect(harness.runtime.calls).toHaveLength(3);
    expect((await harness.budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("no double accounting: each execution writes usage once with its own accounting id", async () => {
    const records: { eventId: string; taskId: string }[] = [];
    const runtime = new PumpRuntime();
    const budget = new BudgetManager({ appendUsage: async record => { if (records.some(x => x.eventId === record.eventId)) return false; records.push({ eventId: record.eventId, taskId: record.taskId }); return true; }, readUsage: async () => records as never }, { paymentStore: paymentStore(), policy: { monthlyBudgetRub: 2000, subscriptionCostRub: null } });
    const directory = seedDirectory();
    const portfolio = new ProjectPortfolio();
    portfolio.register(project("ledger-p", 1));
    const profession = directory.professions.get("director");
    const rm = new RuntimeManager();
    rm.register(runtime);
    const alloc = new ResourceAllocator([{ id: "employee-001", departmentId: profession.departmentId, professionId: profession.id, status: "active", availableSkillIds: [], capabilityRequirements: [] }], portfolio);
    const sched = new TaskScheduler(portfolio, alloc);
    const coordinator = new ExecutionCoordinator({ portfolio, allocator: alloc, scheduler: sched, budget, runtimeManager: rm, directory: { getEmployeeProfile: () => ({ employeeId: "employee-001", profession, modelDefault: "fake/model" }) }, gateway: { select: () => ({ modelId: "fake/model", runtimeId: "fake", provider: "fake", expenseCategory: "free", rationale: "r", fallbacks: [] }) } });
    const first = coordinator.dispatch(request("ledger-1", "ledger-p"));
    const second = coordinator.dispatch(request("ledger-2", "ledger-p"));
    expect(coordinator.listWaiting().map(x => x.taskId)).toEqual(["ledger-2"]);
    await flush();
    runtime.emitUsage("ledger-1:attempt:1", { input: 5, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 10, costUsd: 0 });
    runtime.settle("ledger-1:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    await first;
    await flush();
    runtime.emitUsage("ledger-2:attempt:1", { input: 5, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 10, costUsd: 0 });
    runtime.settle("ledger-2:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    await expect(coordinator.completion("ledger-2")).resolves.toMatchObject({ phase: "completed" });
    const summary = await budget.getUsageSummary();
    expect(summary.eventCount).toBe(2);
    expect(records.map(x => x.taskId).sort()).toEqual(["ledger-1:attempt:1", "ledger-2:attempt:1"]);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
    await second.then(() => undefined);
  });
});

function runtimeExecutions(runtime: PumpRuntime): string[] { return runtime.calls.map(call => String(call.executionId)); }
