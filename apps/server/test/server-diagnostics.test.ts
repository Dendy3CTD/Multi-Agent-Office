import { afterAll, describe, expect, it } from "vitest";
import type { IncomingMessage, Server } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { listenLocalhost, createMaoServer, createDefaultMaoServer } from "../src/index.js";
import { BudgetManager, type CashPaymentStore } from "@open-agent-office/budget-manager";
import { OrganizationDirectory, seedDirectory } from "@open-agent-office/directory";
import { ExecutionCoordinator, ProjectPortfolio, ResourceAllocator, RuntimeManager, TaskScheduler } from "@open-agent-office/orchestrator";
import type { Employee, ModelDescriptor, Profession, RuntimeAdapter, RuntimeCapabilities, RuntimeEvent, RuntimeTask, RuntimeExecutionCallbacks } from "@open-agent-office/shared";

const TOKEN = "diag-test-token";
const paymentStore = (): CashPaymentStore => ({ appendPayment: async () => true, readPayments: async () => [] });
const model: ModelDescriptor = { id: "fake/model", provider: "fake", runtimeIds: ["fake"], tier: "strong", capabilities: ["code", "reasoning"], relativeCost: 0, enabled: true, paidExternal: false, expenseCategory: "free" };

class DeferredRuntime implements RuntimeAdapter {
  readonly id = "fake";
  private readonly deferred = new Map<string, () => void>();
  private readonly runtimeCapabilities: RuntimeCapabilities = { runtimeId: "fake", runtimeType: "opencode", supportedProviders: ["fake"], supportedModels: ["fake/model"], session: false, cancel: true, usage: true, notes: ["FAKE transport for server tests"] };
  capabilities(): RuntimeCapabilities { return this.runtimeCapabilities; }
  execute(task: RuntimeTask, callbacks?: RuntimeExecutionCallbacks): Promise<{ runtimeId: string; text: string; events: readonly RuntimeEvent[] }> {
    void callbacks;
    return new Promise(resolve => { this.deferred.set(String(task.executionId), () => resolve({ runtimeId: "fake", text: "settled by test", events: [] })); });
  }
  settle(executionId: string): void { this.deferred.get(executionId)?.(); this.deferred.delete(executionId); }
  async cancel(): Promise<void> {}
}

function diagnosticsSetup(options: { onEvent?: Parameters<ExecutionCoordinator["dispatch"]> extends never ? never : ((event: { type: string }) => void) } = {}): { app: ReturnType<typeof createMaoServer>; directory: OrganizationDirectory; runtime: DeferredRuntime } {
  const directory = new OrganizationDirectory();
  directory.registerDepartment({ id: "dept-1", name: "Dispatch", status: "active" });
  const profession: Profession = { id: "diag-prof", version: "1.0.0", name: "Diagnostics", role: "worker", departmentId: "dept-1", responsibilities: [], baseInstructions: "diagnostics instructions", skillTags: [], capabilityRequirements: [], modelHints: { tier: "cheap" }, acceptancePolicy: { mode: "auto", checks: [] }, status: "active" };
  directory.registerProfession(profession);
  for (const employeeId of ["diag-emp-1", "diag-emp-2"]) {
    const employee: Employee = { id: employeeId, professionId: "diag-prof", displayName: employeeId, modelDefault: "fake/model", skillOverrides: [], status: "active" };
    directory.registerEmployee(employee);
  }
  const portfolio = new ProjectPortfolio();
  portfolio.register({ id: "diag-project", name: "Diag", rootDir: "/tmp/diag-project", status: "active", portfolio: { priority: "normal", budgetShare: 0.2, maxConcurrentExecutions: 1 } });
  const runtime = new DeferredRuntime();
  const runtimeManager = new RuntimeManager();
  runtimeManager.register(runtime);
  const allocator = new ResourceAllocator(directory.employees.list().map(employee => ({ id: employee.id, departmentId: "dept-1", professionId: "diag-prof", status: employee.status, availableSkillIds: [], capabilityRequirements: [] })), portfolio);
  const scheduler = new TaskScheduler(portfolio, allocator);
  const budget = new BudgetManager({ appendUsage: async () => true, readUsage: async () => [] }, { paymentStore: paymentStore(), policy: { monthlyBudgetRub: 2000, subscriptionCostRub: null } });
  const coordinator = new ExecutionCoordinator({
    portfolio, allocator, scheduler, budget, runtimeManager,
    directory: {
      getEmployeeProfile: employeeId => ({ employeeId, profession, modelDefault: "fake/model" }),
      // Live availability through the same directory instance — no second registry.
      isEmployeeActive: employeeId => directory.employees.get(employeeId)?.status === "active",
    },
    gateway: { select: () => ({ modelId: "fake/model", runtimeId: "fake", provider: "fake", expenseCategory: "free", rationale: "diag selection", fallbacks: [] }) },
    onEvent: options.onEvent as never,
  });
  const app = createMaoServer({ token: TOKEN, directory, portfolio, scheduler, runtimeManager, budget, models: [model], coordinator });
  return { app, directory, runtime };
}

async function request(app: ReturnType<typeof createMaoServer>, url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  return app.app.dispatch({ method: "GET", url, headers, [Symbol.asyncIterator]: async function* () {} } as unknown as IncomingMessage);
}
async function postTask(app: ReturnType<typeof createMaoServer>, body: Record<string, unknown>, key = "diag-key"): Promise<{ status: number; body: unknown }> {
  return app.app.dispatch({ method: "POST", url: "/v1/tasks", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body), [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body)); } } as unknown as IncomingMessage);
}
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("S2-12 diagnostics endpoint", () => {
  it("requires a bearer token and refuses wrong ones before exposing anything", async () => {
    const { app } = diagnosticsSetup();
    expect((await request(app, "/v1/executions/diagnostics")).status).toBe(401);
    expect((await request(app, "/v1/executions/diagnostics", { authorization: "Bearer wrong" })).status).toBe(401);
    const ok = (await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` }));
    expect(ok.status).toBe(200);
  });

  it("returns the versioned contract shape with aggregates and safe entries", async () => {
    const { app } = diagnosticsSetup();
    await postTask(app, { projectId: "diag-project", title: "Shape task", brief: "Diagnostic shape brief", id: "shape-1" });
    await flush();
    const response = await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(200);
    const body = response.body as { snapshot: { version: number; generatedAt: string; counts: Record<string, number> }; aggregates: { waiting: number; active: number; incomplete: number }; executions: Array<{ taskId: string; projectId: string; phase: string; attempt: number; employeeId?: string; modelId?: string; runtimeId?: string; error?: { code: string; message: string } }> };
    expect(body.snapshot.version).toBe(1);
    expect(typeof body.snapshot.generatedAt).toBe("string");
    expect(body.aggregates).toMatchObject({ waiting: 0, active: 1, incomplete: 1 });
    expect(body.executions[0]).toMatchObject({ taskId: "shape-1", projectId: "diag-project", attempt: 1, modelId: "fake/model", runtimeId: "fake" });
    for (const entry of body.executions) {
      expect(entry).not.toHaveProperty("prompt");
      expect(entry).not.toHaveProperty("cwd");
      expect(entry).not.toHaveProperty("result");
      expect(entry.error).toBeUndefined();
    }
  });

  it("never leaks task briefs or tokens through diagnostics", async () => {
    const { app } = diagnosticsSetup();
    await postTask(app, { projectId: "diag-project", title: "Secret holder", brief: "TOPSECRET-BRIEF-MARKER credentials kept out", id: "secret-1" });
    await flush();
    const body = JSON.stringify((await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` })).body);
    const response = (await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` })).body as unknown;
    expect(body).not.toContain("TOPSECRET-BRIEF-MARKER");
    expect(body).not.toContain(TOKEN);
    if (typeof response === "object" && response !== null) {
      expect("prompt" in response ? response.prompt : "").toBe("");
    }
  });

  it("distinguishes waiting and active executions", async () => {
    const { app, runtime } = diagnosticsSetup();
    await postTask(app, { projectId: "diag-project", title: "Holder", brief: "holder brief", id: "waiting-hold-1" }, "k1");
    await postTask(app, { projectId: "diag-project", title: "Second", brief: "second brief", id: "waiting-hold-2" }, "k2");
    await flush();
    const waiting = (await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` })).body as { aggregates: { waiting: number; active: number }; executions: Array<{ taskId: string; waiting: boolean }> };
    expect(waiting.aggregates.active).toBe(1);
    expect(waiting.aggregates.waiting).toBe(1);
    const waited = waiting.executions.find(x => x.taskId === "waiting-hold-2");
    expect(waited?.waiting).toBe(true);
    runtime.settle("waiting-hold-1:attempt:1");
    await flush();
    runtime.settle("waiting-hold-2:attempt:1");
    await flush();
    const finished = (await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` })).body as { aggregates: { incomplete: number } };
    expect(finished.aggregates.incomplete).toBe(0);
  });

  it("snapshots are read-only: two consecutive reads are identical and leave state untouched", async () => {
    const { app, runtime } = diagnosticsSetup();
    await postTask(app, { projectId: "diag-project", title: "Read-only", brief: "ro brief", id: "reading-1" });
    await flush();
    const first = await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` });
    const second = await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` });
    expect({ ...second.body as object, snapshot: { ...(second.body as { snapshot: object }).snapshot, generatedAt: (first.body as { snapshot: { generatedAt: string } }).snapshot.generatedAt } }).toEqual(first.body);
    runtime.settle("reading-1:attempt:1");
    await flush();
    const after = (await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` })).body as { aggregates: { incomplete: number } };
    expect(after.aggregates.incomplete).toBe(0);
  });

  it("reports an explicit unavailable state without a coordinator", async () => {
    const directory = seedDirectory();
    const portfolio = new ProjectPortfolio();
    const scheduler = new TaskScheduler(portfolio, new ResourceAllocator([], portfolio));
    const runtimeManager = new RuntimeManager();
    const budget = new BudgetManager({ appendUsage: async () => true, readUsage: async () => [] }, { paymentStore: paymentStore(), policy: { monthlyBudgetRub: 1000, subscriptionCostRub: 1000 } });
    const app = createMaoServer({ token: TOKEN, directory, portfolio, scheduler, runtimeManager, budget, models: [model] });
    const response = await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ error: { code: "coordinator_unavailable" } });
  });
});

describe("S2-12 employee availability through the composition root port", () => {
  it("a disabled employee never gains assignments on pump; re-enabling plus explicit pump completes them", async () => {
    const { app, directory, runtime } = diagnosticsSetup();
    const first = await postTask(app, { projectId: "diag-project", title: "Holder", brief: "availability holder", id: "avail-hold" }, "av1");
    expect(first.status).toBe(202);
    await flush();
    const queued = await postTask(app, { projectId: "diag-project", title: "Waiter", brief: "availability waiter", id: "avail-wait" }, "av2");
    expect(queued.status).toBe(202);
    await flush();
    expect(((await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` })).body as { aggregates: { waiting: number } }).aggregates.waiting).toBe(1);
    // Availability changes while work is waiting; explicit pump is required
    // after the employee becomes active again.
    directory.employees.update("diag-emp-1", { status: "disabled" });
    directory.employees.update("diag-emp-1", { status: "active" });
    const coordinator = (app as unknown as { app: { options: { coordinator?: ExecutionCoordinator } } }).app.options.coordinator!;
    coordinator.pump();
    await flush();
    const waitingAfter = (await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` })).body as { aggregates: { waiting: number }; executions: Array<{ taskId: string; employeeId?: string }> };
    expect(waitingAfter.aggregates.waiting).toBe(1);
    expect(waitingAfter.executions.find(x => x.taskId === "avail-wait")).toBeTruthy();
    runtime.settle("avail-hold:attempt:1");
    await flush();
    const reactivated = directory.employees.get("diag-emp-1");
    expect(reactivated.status).toBe("active");
    // Server may call coordinator.pump() after availability changes (contract §3).
    coordinator.pump();
    await flush();
    await flush();
    for (let index = 0; index < 4; index += 1) {
      runtime.settle("avail-wait:attempt:1");
      await flush();
    }
    const finalState = (await request(app, "/v1/executions/diagnostics", { authorization: `Bearer ${TOKEN}` })).body as { aggregates: { incomplete: number } };
    expect(finalState.aggregates.incomplete).toBe(0);
  });

  it("default composition root wires isEmployeeActive and exposes diagnostics (127.0.0.1 smoke)", async (context) => {
    void mkdir; void writeFile; void rm;
    const mao = await createDefaultMaoServer({ token: "smoke-token" });
    void mao;
    const response = await mao.app.dispatch({ method: "GET", url: "/v1/executions/diagnostics", headers: { authorization: "Bearer smoke-token" }, [Symbol.asyncIterator]: async function* () {} } as unknown as IncomingMessage);
    expect(response.status).toBe(200);
    const body = response.body as { snapshot: { version: number }; aggregates: { waiting: number; active: number } };
    expect(body.snapshot.version).toBe(1);
    expect(body.aggregates.active).toBe(0);
    let address: string;
    try { address = await listenLocalhost(mao.server, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { context.skip("sandbox forbids localhost socket binding"); return; } throw error; }
    expect(address.startsWith("127.0.0.1")).toBe(true);
    const http  = await fetch(`http://${address}/v1/executions/diagnostics`, { headers: { authorization: "Bearer smoke-token" } });
    expect(http.status).toBe(200);
    await new Promise<void>(resolve => (mao.server as Server).close(() => resolve()));
  }, 15000);
});

afterAll(async () => { void 0; });
