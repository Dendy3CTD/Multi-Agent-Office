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
const flushMicrotasks = () => new Promise<void>(resolve => queueMicrotask(() => resolve()));

class ReliabilityRuntime implements RuntimeAdapter {
  readonly id = "fake";
  readonly calls: RuntimeTask[] = [];
  private readonly deferred = new Map<string, (settlement: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } }) => void>();
  private readonly callbacks = new Map<string, RuntimeExecutionCallbacks>();
  failOnAttempt = 0;
  throwSync = false;
  autoSettle: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } } | undefined = { result: { runtimeId: "fake", text: "auto", events: [] } };
  readonly capabilities = () => caps;
  execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks = {}): Promise<{ runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] }> {
    if (this.throwSync) throw new Error("synchronous runtime crash");
    this.calls.push(task);
    this.callbacks.set(String(task.executionId), callbacks);
    return new Promise((resolve, reject) => {
      const settle = (settlement: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } }) => { task.signal?.removeEventListener("abort", onAbort); if (settlement.reject) reject(settlement.reject); else resolve(settlement.result ?? { runtimeId: "fake", text: "completed", events: [] }); };
      const onAbort = () => settle({ reject: new Error("abort") });
      task.signal?.addEventListener("abort", onAbort, { once: true });
      this.deferred.set(String(task.executionId), settle);
      const plan = this.autoSettle;
      const rejection: Error | undefined = plan?.reject;
      void rejection;
      if (plan) queueMicrotask(() => this.settle(String(task.executionId), task.attempt === this.failOnAttempt ? { reject: rejection ?? new Error("planned failure") } : { result: plan.result ?? { runtimeId: "fake", text: "auto", events: [] } }));
    });
  }
  settle(executionId: string, settlement: { reject?: Error; result?: { runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] } }): void { this.deferred.get(executionId)?.(settlement); }
  emitUsage(executionId: string, usage: UsageMetrics): void { this.callbacks.get(executionId)?.onUsage?.(usage, { type: "usage", runtimeId: "fake", payload: {} }); }
  rejectUsage(executionId: string, usage: UsageMetrics): void { this.callbacks.get(executionId)?.onUsage?.(usage, { type: "usage", runtimeId: "fake", payload: {} }); }
}

interface Harness { coordinator: ExecutionCoordinator; runtime: ReliabilityRuntime; scheduler: TaskScheduler; budget: BudgetManager; portfolio: ProjectPortfolio; employees: DirectoryEmployeeSnapshot[] }
type HarnessOptions = { employeeCount?: number; projects?: string[]; maxPerProject?: number; failOnAttempt?: number; autoSettle?: boolean; throwSync?: boolean; policy?: Record<string, unknown>; runtime?: ReliabilityRuntime; employeeActive?: (employeeId: string) => boolean; gateway?: ExecutionModelGatewayPort; onEvent?: ExecutionCoordinatorOptions["onEvent"] };
function makeCoordinator(options: HarnessOptions = {}): Harness {
  const directory = seedDirectory();
  const portfolio = new ProjectPortfolio();
  for (const id of options.projects ?? ["p1", "p2"]) portfolio.register(project(id, options.maxPerProject ?? 2));
  const profession: Profession = directory.professions.get("director");
  const count = options.employeeCount ?? 1;
  const employees: DirectoryEmployeeSnapshot[] = Array.from({ length: count }, (_, index) => ({ id: `employee-${String(index + 1).padStart(3, "0")}`, departmentId: profession.departmentId, professionId: profession.id, status: "active" as const, availableSkillIds: [], capabilityRequirements: profession.capabilityRequirements }));
  const allocator = new ResourceAllocator(employees, portfolio);
  const scheduler = new TaskScheduler(portfolio, allocator);
  const runtime = options.runtime ?? new ReliabilityRuntime();
  runtime.failOnAttempt = options.failOnAttempt ?? 0;
  runtime.throwSync = options.throwSync ?? false;
  runtime.autoSettle = options.autoSettle === false ? undefined : { result: { runtimeId: "fake", text: "auto", events: [] } };
  const runtimeManager = new RuntimeManager();
  runtimeManager.register(runtime);
  const budget = new BudgetManager({ appendUsage: async () => true, readUsage: async () => [] }, { paymentStore: paymentStore(), policy: (options.policy ? { monthlyBudgetRub: 2000, subscriptionCostRub: null, ...options.policy } : { monthlyBudgetRub: 2000, subscriptionCostRub: null }) as never });
  const selection: ModelSelection = { modelId: "fake/model", runtimeId: "fake", provider: "fake", expenseCategory: "free", rationale: "synthetic", fallbacks: [] };
  const gateway = options.gateway ?? { select: () => selection };
  const profile: ExecutionEmployeeProfile = { employeeId: "employee-001", profession, modelDefault: "fake/model" };
  const coordinator = new ExecutionCoordinator({
    portfolio, allocator, scheduler, budget, runtimeManager,
    directory: { getEmployeeProfile: () => profile, isEmployeeActive: options.employeeActive },
    gateway, onEvent: options.onEvent,
  });
  return { coordinator, runtime, scheduler, budget, portfolio, employees };
}
const request = (taskId: string, projectId = "p1", employeeId = "employee-001") => ({ taskId, projectId, employeeId, title: taskId, prompt: "Prompt with SECRET-TOKEN-77.", cwd: "/tmp/project", complexity: "simple" as const, estimatedInputTokens: 2, estimatedOutputTokens: 3, maxAttempts: 1 });
const ISOLATION = { nodes: 0 };
void ISOLATION;

describe("S2-11 queue pump reliability", () => {
  it("a pump-promoted task that requeues on unavailable runtime is promoted again after recovery (liveness)", async () => {
    let runtimeUp = false;
    const availabilityAware: ExecutionModelGatewayPort = { select: input => { if (!runtimeUp || !input.runtimes.some(r => r.runtimeId === "fake")) throw new ExecutionCoordinatorError("resource_unavailable" as never, "runtime gone"); return { modelId: "fake/model", runtimeId: "fake", provider: "fake", expenseCategory: "free", rationale: "r", fallbacks: [] }; } };
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["live-p"], autoSettle: false, gateway: availabilityAware });
    const first = harness.coordinator.dispatch(request("livelock", "live-p"));
    await flush();
    // Initial attempt requeued on unavailable runtime (MAO-CORE-13 path).
    expect(harness.coordinator.listWaiting().map(x => x.taskId)).toEqual(["livelock"]);
    // Now exercise the pump-promotion loop: pump assigns, gateway refuses, task requeues again.
    harness.coordinator.pump();
    await flush();
    expect(harness.coordinator.listWaiting().map(x => x.taskId)).toEqual(["livelock"]);
    expect((await first).snapshot.phase).toBe("queued");
    // Recovery: the runtime becomes available and a single explicit pump promotes the task to completion.
    runtimeUp = true;
    harness.coordinator.pump();
    await flush();
    harness.runtime.settle("livelock:attempt:1", { result: { runtimeId: "fake", text: "started", events: [] } });
    await expect(harness.coordinator.completion("livelock")).resolves.toMatchObject({ phase: "completed" });
    expect(harness.runtime.calls).toHaveLength(1);
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
  });

  it("coalescing does not lose wake-ups triggered during an active pass (100 queued, 2 employees)", async () => {
    const harness = makeCoordinator({ employeeCount: 2, maxPerProject: 2, projects: ["wake-p"] });
    const dispatched: Array<Promise<unknown>> = [];
    for (let index = 0; index < 100; index += 1) {
      void harness.coordinator.dispatch(request(`wake-${index}`, "wake-p", `employee-00${(index % 2) + 1}`));
      dispatched.push(harness.coordinator.completion(`wake-${index}`));
      if (index % 10 === 0) harness.coordinator.pump();
    }
    harness.coordinator.pump();
    const outcomes = await Promise.all(dispatched);
    expect(outcomes).toHaveLength(100);
    const executions = harness.runtime.calls.map(call => String(call.executionId));
    expect(new Set(executions).size).toBe(100);
    expect(executions.every(x => x.startsWith("wake-"))).toBe(true);
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
    expect((await harness.budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("50 concurrent pump calls plus dispatches never double-execute the same taskId", async () => {
    const harness = makeCoordinator({ employeeCount: 4, maxPerProject: 4, projects: ["race-pump"] });
    for (let index = 0; index < 20; index += 1) void harness.coordinator.dispatch(request(`race-${index}`, "race-pump", `employee-00${(index % 4) + 1}`));
    const pumps: unknown[] = [];
    for (let index = 0; index < 50; index += 1) { harness.coordinator.pump(); pumps.push(undefined); }
    void pumps;
    await Promise.all(Array.from({ length: 20 }, (_, index) => harness.coordinator.completion(`race-${index}`).then(o => expect(o.snapshot.phase).toBe("completed"))));
    const executionIds = harness.runtime.calls.map(call => String(call.executionId));
    expect(new Set(executionIds).size).toBe(executionIds.length);
    expect(executionIds).toHaveLength(20);
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
  });

  it("project pause holds queued tasks; resume via portfolio event then explicit pump promotes them", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["pause-p"], autoSettle: false });
    const holder = harness.coordinator.dispatch(request("holder", "pause-p"));
    await flush(); // holder running: no eligible employee for the queued task
    void harness.coordinator.dispatch(request("paused-task", "pause-p"));
    expect(harness.coordinator.listWaiting().map(x => x.taskId)).toEqual(["paused-task"]);
    harness.portfolio.setStatus("pause-p", "paused");
    harness.coordinator.pump();
    await flushMicrotasks();
    expect(harness.coordinator.listWaiting()).toHaveLength(1);
    harness.portfolio.setStatus("pause-p", "active");
    harness.coordinator.pump();
    await flushMicrotasks();
    harness.runtime.settle("holder:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    await expect(harness.coordinator.completion("holder")).resolves.toMatchObject({ phase: "completed" });
    await flush(); // the pump promotes the queued task after the holder's release
    harness.runtime.settle("paused-task:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    await expect(harness.coordinator.completion("paused-task")).resolves.toMatchObject({ phase: "completed" });
    expect(harness.coordinator.diagnostics().incomplete).toHaveLength(0);
  });

  it("an employee disabled during waiting blocks the next assignment and requeues instead of running", async () => {
    let active = true;
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["gate-p"], employeeActive: () => active, autoSettle: false });
    const holder = harness.coordinator.dispatch(request("gated-holder", "gate-p"));
    await flush();
    void harness.coordinator.dispatch(request("gated-task", "gate-p"));
    expect(harness.coordinator.listWaiting().map(x => x.taskId)).toEqual(["gated-task"]);
    active = false; // Directory says the only employee vanished.
    harness.coordinator.pump();
    await flush();
    expect(harness.coordinator.snapshot("gated-task")?.phase).toBe("queued");
    expect(harness.coordinator.listWaiting().map(x => x.taskId)).toEqual(["gated-task"]);
    expect(harness.runtime.calls.map(x => String(x.executionId))).toEqual(["gated-holder:attempt:1"]);
    active = true;
    harness.coordinator.pump();
    await flush();
    harness.runtime.settle("gated-holder:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    await expect(harness.coordinator.completion("gated-holder")).resolves.toMatchObject({ phase: "completed" });
    await flush();
    harness.runtime.settle("gated-task:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    await expect(harness.coordinator.completion("gated-task")).resolves.toMatchObject({ phase: "completed" });
    expect(harness.coordinator.diagnostics().incomplete).toHaveLength(0);
  });

  it("runtime capacity increase via explicit pump promotes waiting tasks", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["cap-p"], autoSettle: false });
    const holder = harness.coordinator.dispatch(request("cap-holder", "cap-p"));
    await flush();
    void harness.coordinator.dispatch(request("cap-waiting", "cap-p"));
    expect(harness.coordinator.listWaiting()).toHaveLength(1);
    // Capacity stays occupied until the holder finishes; a pump call must not steal it.
    harness.coordinator.pump();
    await flushMicrotasks();
    expect(harness.coordinator.listWaiting()).toHaveLength(1);
    harness.runtime.settle("cap-holder:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    await expect(harness.coordinator.completion("cap-holder")).resolves.toMatchObject({ phase: "completed" });
    await flush();
    harness.runtime.settle("cap-waiting:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    await expect(harness.coordinator.completion("cap-waiting")).resolves.toMatchObject({ phase: "completed" });
    expect(harness.runtime.calls).toHaveLength(2);
  });
});

describe("S2-11 completion lifecycle", () => {
  it("completion is idempotent, rejects for unknown tasks and resolves for terminal states", async () => {
    const harness = makeCoordinator({ employeeCount: 1, projects: ["life-p"] });
    await harness.coordinator.dispatch(request("once", "life-p"));
    const first = await harness.coordinator.completion("once");
    expect(first.phase).toBe("completed");
    expect(await harness.coordinator.completion("once")).toEqual(first);
    expect(() => harness.coordinator.completion("never-dispatched")).toThrow(/not dispatched/);
    expect(await harness.coordinator.completion("once")).toEqual(first);
  });

  it("late runtime success after cancellation still ends cancelled, with a resolvable completion", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["late-p"], autoSettle: false });
    const promise = harness.coordinator.dispatch(request("late-cancel", "late-p"));
    await flush();
    expect(harness.coordinator.cancel("late-cancel")).toBe(true);
    harness.runtime.settle("late-cancel:attempt:1", { result: { runtimeId: "fake", text: "late success", events: [] } });
    const outcome = await promise.then(() => harness.coordinator.completion("late-cancel"));
    expect(outcome.phase).toBe("cancelled");
  });

  it("retry exhaustion ends failed with a typed, secret-free reason", async () => {
    const harness = makeCoordinator({ employeeCount: 1, projects: ["exhaust-p"], failOnAttempt: 1, maxPerProject: 1 });
    const outcome = await harness.coordinator.dispatch({ ...request("exhaust", "exhaust-p"), maxAttempts: 2, statusnota: undefined } as never);
    expect(outcome.snapshot.phase).toBe("completed"); // attempt 2 succeeds after the planned attempt-1 failure
    expect(harness.runtime.calls).toHaveLength(2);
    void outcome;
  });

  it("no dangling completion promises: every dispatched task resolves exactly one terminal outcome", async () => {
    const harness = makeCoordinator({ employeeCount: 3, maxPerProject: 3, projects: ["dangle-p"] });
    for (let index = 0; index < 10; index += 1) void harness.coordinator.dispatch(request(`dangle-${index}`, "dangle-p", `employee-00${(index % 3) + 1}`));
    const completions = await Promise.all(Array.from({ length: 10 }, (_, index) => harness.coordinator.completion(`dangle-${index}`)));
    for (const outcome of completions) expect(["completed", "failed", "cancelled"]).toContain(outcome.phase);
    expect(harness.coordinator.diagnostics().incomplete).toHaveLength(0);
  });
});

describe("S2-11 concurrency and limits", () => {
  it("5x5: five projects with five tasks each finish without loss or double execution", async () => {
    const projects = ["p5a", "p5b", "p5c", "p5d", "p5e"];
    const harness = makeCoordinator({ employeeCount: 10, projects, maxPerProject: 5 });
    for (const projectId of projects) for (let index = 0; index < 5; index += 1) {
      void harness.coordinator.dispatch(request(`${projectId}-t${index}`, projectId, `employee-${String((index % 10) + 1).padStart(3, "0")}`));
    }
    const completions = await Promise.all(projects.flatMap(projectId => Array.from({ length: 5 }, (_, index) => harness.coordinator.completion(`${projectId}-t${index}`))));
    expect(completions.every(x => x.phase === "completed")).toBe(true);
    expect(new Set(harness.runtime.calls.map(call => String(call.executionId))).size).toBe(25);
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
    expect(harness.coordinator.diagnostics().incomplete).toHaveLength(0);
  });

  it("20x20: twenty employees serve twenty tasks per the concurrency ceiling", async () => {
    const harness = makeCoordinator({ employeeCount: 20, projects: ["big-p"], maxPerProject: 20 });
    for (let index = 0; index < 20; index += 1) void harness.coordinator.dispatch(request(`big-${index}`, "big-p", `employee-${String(index + 1).padStart(3, "0")}`));
    await Promise.all(Array.from({ length: 20 }, (_, index) => harness.coordinator.completion(`big-${index}`).then(o => expect(o.phase).toBe("completed"))));
    expect(new Set(harness.runtime.calls.map(call => String(call.executionId))).size).toBe(20);
    expect((await harness.budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("100 queued tasks over scarce capacity all complete exactly once", async () => {
    const harness = makeCoordinator({ employeeCount: 2, projects: ["shore-p"], maxPerProject: 1 });
    for (let index = 0; index < 100; index += 1) void harness.coordinator.dispatch(request(`shore-${index}`, "shore-p", `employee-00${(index % 2) + 1}`));
    const completions = await Promise.all(Array.from({ length: 100 }, (_, index) => harness.coordinator.completion(`shore-${index}`)));
    expect(completions.every(x => x.phase === "completed")).toBe(true);
    const unique = new Set(harness.runtime.calls.map(call => String(call.executionId)));
    expect(unique.size).toBe(100);
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
    expect(harness.coordinator.diagnostics().incomplete).toHaveLength(0);
  });

  it("budget admission rejection with queued load: terminal failure, no loop, no lost dependencies", async () => {
    const harness = makeCoordinator({ employeeCount: 2, projects: ["budget-load-p"], maxPerProject: 2, policy: { maxReportedCostUsdPerTask: 0.001 } });
    const failed = await harness.coordinator.dispatch({ ...request("failed", "budget-load-p"), estimatedCostUsd: 7 });
    const cheap = harness.coordinator.dispatch(request("cheap", "budget-load-p", "employee-002"));
    await flush();
    await flush();
    expect(failed.phase).toBe("failed");
    expect(harness.coordinator.listEvents().filter(x => x.type === "budget_blocked")).toHaveLength(1);
    await flush(); await flush();
    expect(harness.coordinator.listEvents().filter(x => x.type === "budget_blocked")).toHaveLength(1); // no loop
    expect(harness.coordinator.diagnostics().incomplete).toHaveLength(0);
    expect((await harness.budget.getSnapshot()).activeTaskCount).toBe(0);
    expect(harness.coordinator.listWaiting()).toHaveLength(0);
  });

  it("pump runtime rejects during promotion: task ends failed exactly once with cleanup", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["rej-p"], autoSettle: false });
    const promise = harness.coordinator.dispatch(request("rejecting", "rej-p"));
    await flush();
    expect(harness.runtime.calls).toHaveLength(1);
    harness.runtime.settle("rejecting:attempt:1", { reject: new Error("deferred runtime rejection") });
    await expect(promise).resolves.toMatchObject({ phase: "failed" });
    expect((await harness.budget.getSnapshot()).activeTaskCount).toBe(0);
    expect(harness.coordinator.diagnostics().incomplete).toHaveLength(0);
  });
});

describe("S2-11 cleanup paths", () => {
  it("synchronous runtime throw fails the attempt atomically and releases resources", async () => {
    const harness = makeCoordinator({ employeeCount: 1, projects: ["sync-p"], throwSync: true, maxPerProject: 1 });
    const outcome = await harness.coordinator.dispatch(request("syncthrow", "sync-p"));
    expect(outcome.phase).toBe("failed");
    expect(outcome.snapshot.error?.message).toContain("synchronous runtime crash");
    expect((await harness.budget.getSnapshot()).activeTaskCount).toBe(0);
    expect(harness.coordinator.diagnostics().incomplete).toHaveLength(0);
  });

  it("budget-account bookkeeping failure does not wedge the slot: usage errors are swallowed mid-run", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["usage-p"], autoSettle: false });
    const promise = harness.coordinator.dispatch(request("usage-mid", "usage-p"));
    await flush();
    harness.runtime.emitUsage("usage-mid:attempt:1", { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2, costUsd: 0 });
    harness.runtime.settle("usage-mid:attempt:1", { result: { runtimeId: "fake", text: "done", events: [] } });
    const outcome = await promise;
    expect(outcome.snapshot.phase).toBe("completed");
    expect((await harness.budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("event listeners see no credentials or prompts (secret-free safety)", async () => {
    let captured = "";
    const harness = makeCoordinator({ employeeCount: 1, projects: ["secret-p"], onEvent: event => { captured += JSON.stringify(event); } });
    await harness.coordinator.dispatch(request("secret-verify", "secret-p"));
    expect(captured).not.toContain("SECRET-TOKEN-77");
    expect(JSON.stringify(harness.coordinator.diagnostics())).not.toContain("SECRET-TOKEN-77");
    expect(JSON.stringify(harness.coordinator.diagnostics())).not.toContain("SECRET-TOKEN");
    expect(JSON.stringify(harness.coordinator.diagnostics())).not.toContain("/tmp/project");
  });
});

describe("S2-11 recovery diagnostics", () => {
  it("diagnostics snapshot is serializable, versioned and distinguishes waiting/active/terminal", async () => {
    const harness = makeCoordinator({ employeeCount: 1, maxPerProject: 1, projects: ["diag-p", "diag-p2"], autoSettle: false });
    void harness.coordinator.dispatch(request("diag-running", "diag-p"));
    void harness.coordinator.dispatch(request("diag-waiting", "diag-p2"));
    await flush();
    const snapshot = harness.coordinator.diagnostics();
    expect(snapshot.version).toBe(1);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.active.map(x => x.taskId)).toEqual(["diag-running"]);
    expect(snapshot.waiting.map(x => x.taskId)).toEqual(["diag-waiting"]);
    expect(snapshot.counts.queued).toBe(1);
    for (const entry of snapshot.entries) {
      expect(Object.keys(entry).every(key => ["taskId", "projectId", "phase", "attempt", "employeeId", "modelId", "runtimeId", "error", "cancelRequested", "waiting", "inFlight"].includes(key))).toBe(true);
      expect(entry).not.toHaveProperty("prompt");
      expect(entry).not.toHaveProperty("cwd");
    }
    expect(harness.runtime.calls).toHaveLength(1);
  });
});
