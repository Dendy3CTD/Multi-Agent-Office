import { describe, expect, it } from "vitest";
import { BudgetManager, type CashPaymentStore, type UsageStore } from "@open-agent-office/budget-manager";
import { seedDirectory } from "../../directory/src/index.js";
import type { ModelSelection, Profession, RuntimeAdapter, RuntimeCapabilities, RuntimeEvent, RuntimeTask, RuntimeExecutionCallbacks } from "@open-agent-office/shared";
import { ExecutionCoordinator, type ExecutionEmployeeProfile, type ExecutionModelGatewayPort } from "../src/execution-coordinator.js";
import { ProjectPortfolio } from "../src/portfolio-manager.js";
import { ResourceAllocator, type DirectoryEmployeeSnapshot } from "../src/resource-allocator.js";
import { RuntimeManager } from "../src/runtime-manager.js";
import { TaskScheduler } from "../src/scheduler.js";

const usageStore = (): UsageStore => ({ appendUsage: async () => true, readUsage: async () => [] });
const paymentStore = (): CashPaymentStore => ({ appendPayment: async () => true, readPayments: async () => [] });
const project = (id: string, max = 2) => ({ id, name: id, rootDir: `/tmp/${id}`, status: "active" as const, portfolio: { priority: "normal" as const, budgetShare: 0.2, maxConcurrentExecutions: max } });
const caps: RuntimeCapabilities = { runtimeId: "fake", runtimeType: "opencode", supportedProviders: ["fake"], supportedModels: ["fake/model"], session: false, cancel: true, usage: true };

class FakeRuntime implements RuntimeAdapter {
  readonly id = "fake"; readonly calls: RuntimeTask[] = []; readonly capabilities = () => caps; mode: "success" | "failure" | "hold" = "success"; private rejectHeld?: (error: Error) => void;
  execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks): Promise<{ runtimeId: "fake"; text: string; events: readonly RuntimeEvent[] }> { this.calls.push(task); callbacks.onEvent?.({ type: "message", runtimeId: "fake", payload: { safe: true } }); callbacks.onUsage?.({ input: 2, output: 3, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 5, costUsd: 0 }, { type: "usage", runtimeId: "fake", payload: {} }); if (this.mode === "failure") return Promise.reject(new Error("synthetic runtime failure")); if (this.mode === "hold") return new Promise((_, reject) => { this.rejectHeld = reject; }); return Promise.resolve({ runtimeId: "fake", text: "synthetic result", events: [] }); }
  cancel(): Promise<void> { this.rejectHeld?.(new Error("synthetic cancellation")); return Promise.resolve(); }
}

function makeCoordinator(options: { budgetBlocked?: boolean; runtime?: FakeRuntime; employees?: readonly DirectoryEmployeeSnapshot[] } = {}) {
  const directory = seedDirectory(); const portfolio = new ProjectPortfolio(); portfolio.register(project("p1")); portfolio.register(project("p2"));
  const employeeId = "employee-001"; const employee = directory.employees.get(employeeId); const profession = directory.professions.get(employee.professionId);
  const employees = options.employees ?? [{ id: employeeId, departmentId: profession.departmentId, professionId: profession.id, status: "active" as const, availableSkillIds: [], capabilityRequirements: profession.capabilityRequirements }];
  const allocator = new ResourceAllocator(employees, portfolio); const scheduler = new TaskScheduler(portfolio, allocator); const runtime = options.runtime ?? new FakeRuntime(); const runtimeManager = new RuntimeManager(); runtimeManager.register(runtime);
  const budget = new BudgetManager(usageStore(), { paymentStore: paymentStore(), policy: options.budgetBlocked ? { monthlyBudgetRub: 1000, subscriptionCostRub: 1000, maxReportedCostUsdPerTask: 0.5 } : { monthlyBudgetRub: 2000, subscriptionCostRub: null } });
  const selection: ModelSelection = { modelId: "fake/model", runtimeId: "fake", provider: "fake", expenseCategory: "free", rationale: "synthetic test selection", fallbacks: [] };
  const gateway: ExecutionModelGatewayPort = { select: () => selection };
  const profile: ExecutionEmployeeProfile = { employeeId, profession, modelDefault: "fake/model" };
  const coordinator = new ExecutionCoordinator({ portfolio, allocator, scheduler, budget, runtimeManager, directory: { getEmployeeProfile: () => profile }, gateway });
  return { coordinator, runtime, scheduler, budget, portfolio, employeeId };
}
const request = (taskId: string, projectId = "p1", employeeId = "employee-001") => ({ taskId, projectId, employeeId, title: taskId, prompt: "synthetic prompt", cwd: "/tmp/project", complexity: "simple" as const, estimatedInputTokens: 2, estimatedOutputTokens: 3, maxAttempts: 1 });

describe("S2-9 execution orchestration", () => {
  it("executes a task through scheduler, budget admission and RuntimeManager", async () => { const { coordinator, runtime, scheduler, budget } = makeCoordinator(); const outcome = await coordinator.dispatch(request("success")); expect(outcome.phase).toBe("completed"); expect(runtime.calls).toHaveLength(1); expect(coordinator.snapshot("success")?.phase).toBe("completed"); expect(scheduler.pending()).toHaveLength(0); expect((await budget.getSnapshot()).activeTaskCount).toBe(0); expect(coordinator.listEvents().map(x => x.type)).toEqual(expect.arrayContaining(["task_scheduled", "task_started", "task_completed", "resource_released"])); });
  it("does not call Runtime when Budget admission is rejected and releases resources", async () => { const { coordinator, runtime, scheduler, budget } = makeCoordinator({ budgetBlocked: true }); const outcome = await coordinator.dispatch({ ...request("blocked"), estimatedCostUsd: 1 }); expect(outcome.phase).toBe("failed"); expect(runtime.calls).toHaveLength(0); expect(scheduler.pending()).toHaveLength(0); expect((await budget.getSnapshot()).activeTaskCount).toBe(0); expect(coordinator.listEvents().some(x => x.type === "budget_blocked")).toBe(true); });
  it("releases resources after Runtime failure and supports bounded retry", async () => { const runtime = new FakeRuntime(); runtime.mode = "failure"; const { coordinator, scheduler, budget } = makeCoordinator({ runtime }); const outcome = await coordinator.dispatch({ ...request("failure"), maxAttempts: 2 }); expect(outcome.phase).toBe("failed"); expect(runtime.calls).toHaveLength(2); expect((await budget.getSnapshot()).activeTaskCount).toBe(0); expect(scheduler.pending()).toHaveLength(0); });
  it("prevents duplicate execution and cancels queued tasks", async () => { const { coordinator, runtime, scheduler } = makeCoordinator(); const first = coordinator.dispatch(request("duplicate")); const second = coordinator.dispatch(request("duplicate")); expect(first).toBe(second); await first; expect(runtime.calls).toHaveLength(1); const queued = makeCoordinator({ employees: [] }); const pending = queued.coordinator.dispatch(request("queued")); expect((await pending).phase).toBe("queued"); expect(queued.coordinator.cancel("queued")).toBe(true); expect(queued.coordinator.snapshot("queued")?.phase).toBe("cancelled"); expect(queued.scheduler.pending()).toHaveLength(0); });
  it("cancels an active fake execution and does not leak the budget slot", async () => { const runtime = new FakeRuntime(); runtime.mode = "hold"; const { coordinator, budget } = makeCoordinator({ runtime }); const promise = coordinator.dispatch(request("active-cancel")); await new Promise(resolve => setTimeout(resolve, 0)); expect(coordinator.cancel("active-cancel")).toBe(true); expect((await promise).phase).toBe("cancelled"); expect((await budget.getSnapshot()).activeTaskCount).toBe(0); });
  it("keeps project and task identities isolated", async () => { const { coordinator } = makeCoordinator(); const one = await coordinator.dispatch(request("p1-task", "p1")); const two = await coordinator.dispatch(request("p2-task", "p2")); expect(one.snapshot.projectId).toBe("p1"); expect(two.snapshot.projectId).toBe("p2"); expect(coordinator.listEvents().filter(x => x.taskId === "p1-task").every(x => x.projectId === "p1")).toBe(true); });
});
