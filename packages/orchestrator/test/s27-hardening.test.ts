import { describe, expect, it } from "vitest";
import type { Project, RuntimeDescriptor } from "@open-agent-office/shared";
import { ProjectPortfolio } from "../src/portfolio-manager.js";
import { ResourceAllocator, type DirectoryEmployeeSnapshot } from "../src/resource-allocator.js";
import { TaskScheduler } from "../src/scheduler.js";

const project = (id: string, priority: Project["portfolio"]["priority"] = "normal", max = 2, status: Project["status"] = "active"): Project => ({ id, name: id, rootDir: `/tmp/${id}`, status, portfolio: { priority, budgetShare: 0.2, maxConcurrentExecutions: max } });
const employee = (id: string, overrides: Partial<DirectoryEmployeeSnapshot> = {}): DirectoryEmployeeSnapshot => ({ id, departmentId: "software", professionId: "backend", status: "active", availableSkillIds: [], capabilityRequirements: [], ...overrides });
const runtime = (id: string, over: Partial<RuntimeDescriptor["capabilities"]> = {}, status: RuntimeDescriptor["status"] = "available"): RuntimeDescriptor => ({ id, displayName: id, package: "test", status, capabilities: { runtimeId: id, runtimeType: "opencode", supportedProviders: ["opencode-go"], supportedModels: "*", session: true, ...over } });
const setup = (options: { employees?: DirectoryEmployeeSnapshot[]; runtimes?: RuntimeDescriptor[]; projects?: Project[] } = {}) => {
  const portfolio = new ProjectPortfolio();
  for (const p of options.projects ?? [project("p1"), project("p2", "high", 2)]) portfolio.register(p);
  const allocator = new ResourceAllocator(options.employees ?? [employee("alice"), employee("bob")], portfolio, options.runtimes ?? []);
  return { portfolio, allocator, scheduler: new TaskScheduler(portfolio, allocator) };
};

describe("portfolio hardening", () => {
  it("accepts five projects with 20% budgetShare each (float tolerance)", () => {
    const portfolio = new ProjectPortfolio();
    for (let index = 0; index < 5; index += 1) portfolio.register(project(`share-${index}`));
    expect(portfolio.totalActiveBudgetShare()).toBeCloseTo(1, 9);
    expect(() => portfolio.register(project("share-6"))).toThrow(/must not exceed 1/);
  });

  it("budgetShare totals exclude paused and archived projects", () => {
    const portfolio = new ProjectPortfolio();
    for (let index = 0; index < 5; index += 1) portfolio.register(project(`g-${index}`));
    portfolio.setStatus("g-0", "paused");
    expect(portfolio.totalActiveBudgetShare()).toBeCloseTo(0.8, 9);
    expect(() => portfolio.register(project("g-6", "normal", 2, "active"))).not.toThrow();
  });

  it("rejects garbage status values without mutating anything", () => {
    const { portfolio } = setup();
    const before = portfolio.snapshot();
    expect(() => portfolio.setStatus("p1", "bogus" as never)).toThrow(TypeError);
    expect(portfolio.snapshot()).toEqual(before);
  });

  it("guards registrations of unknown projects and preserves state after failed operations", () => {
    const { portfolio } = setup();
    expect(() => portfolio.setStatus("ghost", "paused")).toThrow(/not found/);
    expect(() => portfolio.reserve("ghost", "task-x")).toThrow(/not found/);
    expect(() => portfolio.get("ghost")).toThrow();
    expect(portfolio.list()).toHaveLength(2);
  });

  it("supports pause -> queue -> resume without losing queued tasks", () => {
    const { portfolio, scheduler } = setup();
    portfolio.setStatus("p1", "paused");
    scheduler.enqueue({ taskId: "queued-while-paused", projectId: "p1", priority: "normal" });
    expect(scheduler.schedule(2).assigned).toHaveLength(0);
    expect(scheduler.pending()).toHaveLength(1);
    portfolio.setStatus("p1", "active");
    expect(scheduler.schedule(2).assigned[0].taskId).toBe("queued-while-paused");
  });
});

describe("allocator hardening", () => {
  it("refuses direct allocation into paused or archived projects and busy employees", () => {
    const { portfolio, allocator } = setup();
    portfolio.setStatus("p1", "paused");
    expect(allocator.allocate({ taskId: "t-paused", projectId: "p1", priority: "normal" })).toBeUndefined();
    portfolio.setStatus("p1", "archived");
    expect(allocator.allocate({ taskId: "t-archived", projectId: "p1", priority: "normal" })).toBeUndefined();
    portfolio.setStatus("p1", "active");
    expect(allocator.allocate({ taskId: "t-ok", projectId: "p1", priority: "normal" })).toBeTruthy();
    expect(allocator.isBusy("alice")).toBe(true);
    expect(allocator.allocate({ taskId: " другая", projectId: "p2", priority: "normal" })).toBeUndefined();
    allocator.release("t-ok");
    expect(allocator.isBusy("alice")).toBe(false);
  });

  it("enforces runtime provider pinning and model prefixes (ADR-MAO-011)", () => {
    const codex = runtime("codex", { supportedProviders: ["chatgpt-plus"], supportedModels: "*" });
    const opencode = runtime("opencode", { supportedProviders: ["opencode-go"], supportedModels: ["opencode-go"] });
    const { allocator } = setup({ runtimes: [codex, opencode] });
    // codex runtime cannot serve an opencode-go model even if it claims "*"
    expect(allocator.allocate({ taskId: "cross", projectId: "p1", priority: "normal", runtimeId: "codex", modelId: "opencode-go/glm-5.3-flash" })).toBeUndefined();
    expect(allocator.allocate({ taskId: "correct", projectId: "p1", priority: "normal", runtimeId: "opencode", modelId: "chatgpt-plus/x" })).toBeUndefined();
    expect(allocator.allocate({ taskId: "ok-model", projectId: "p1", priority: "normal", runtimeId: "opencode", modelId: "opencode-go/glm-5.3-flash" })).toBeTruthy();
  });

  it("rejects unavailable runtime even for a correct provider", () => {
    const { allocator } = setup({ runtimes: [runtime("opencode", {}, "unavailable")] });
    expect(allocator.allocate({ taskId: "down", projectId: "p1", priority: "normal", runtimeId: "opencode" })).toBeUndefined();
  });

  it("keeps the employee identity across runtimes: selection never rewrites the employee", () => {
    const { allocator } = setup({ runtimes: [runtime("opencode"), runtime("codex")] });
    const onOpen = allocator.allocate({ taskId: "ident-1", projectId: "p1", priority: "normal", runtimeId: "opencode", employeeId: "alice" });
    allocator.release("ident-1");
    const onCodex = allocator.allocate({ taskId: "ident-2", projectId: "p1", priority: "normal", runtimeId: "codex", employeeId: "alice" });
    expect(onOpen?.employeeId).toBe("alice");
    expect(onCodex?.employeeId).toBe("alice");
  });

  it("rejects slot computations with malformed inputs", () => {
    const { allocator } = setup();
    expect(() => allocator.computeTargetSlots({ runtimeConcurrency: Number.NaN })).toThrow(TypeError);
    expect(() => allocator.computeTargetSlots({ runtimeConcurrency: 2.5 })).toThrow(TypeError);
    expect(() => allocator.computeTargetSlots({ runtimeConcurrency: -1 })).toThrow(TypeError);
    expect(() => allocator.computeTargetSlots({ activeEmployeeCount: -5 })).toThrow(TypeError);
    expect(() => allocator.computeTargetSlots({ requestedTarget: 1.5 })).toThrow(TypeError);
  });

  it("treats empty availability as unknown quota (permissive), declared-false categories as blocked", () => {
    const { allocator } = setup({ employees: [employee("e1"), employee("e2"), employee("e3"), employee("e4")] });
    // Unknown quota (nothing reported) never zeroes out capacity silently.
    expect(allocator.computeTargetSlots({ requestedTarget: 10, runtimeConcurrency: 10, categoryAvailability: {} }).slots).toBeGreaterThan(0);
    // Per-task-category computes: a task whose categories are all known-false gets no slots
    expect(allocator.computeTargetSlots({ requestedTarget: 10, runtimeConcurrency: 10, categoryAvailability: { subscription: false, local: false } }).slots).toBe(0);
    expect(allocator.computeTargetSlots({ requestedTarget: 10, runtimeConcurrency: 10, categoryAvailability: { subscription: false, free: true } }).slots).toBe(4);
    expect(allocator.computeTargetSlots({ requestedTarget: 10, runtimeConcurrency: 10, categoryAvailability: { free: false, subscription: true } }).slots).toBe(4);
    expect(allocator.computeTargetSlots({ budgetStatus: "unknown" }).slots).toBe(2);
  });

  it("freezes history entries against mutation", () => {
    const { allocator } = setup();
    allocator.computeTargetSlots({});
    const history = allocator.history();
    expect(Object.isFrozen(history[0])).toBe(true);
    expect(Object.isFrozen(history[0].perProject)).toBe(true);
    expect(() => (history[0] as { slots: number }).slots = 99).toThrow();
  });

  it("promotion: free availability allows work while subscription is blocked, blocked budget zeroes everything", () => {
    const { allocator } = setup({ employees: [employee("e1"), employee("e2")] });
    expect(allocator.computeTargetSlots({ budgetStatus: "blocked", categoryAvailability: { free: true } }).slots).toBe(0);
    expect(allocator.computeTargetSlots({ budgetStatus: "critical", categoryAvailability: { free: false, subscription: true } }).slots).toBe(2);
  });
});

describe("scheduler hardening", () => {
  it("rejects invalid identifiers, priorities and archived projects", () => {
    const { portfolio, scheduler } = setup({ projects: [project("p1"), project("finished", "normal", 2)] });
    portfolio.setStatus("finished", "archived");
    expect(() => scheduler.enqueue({ taskId: "bad id", projectId: "p1", priority: "normal" })).toThrow(/task id/);
    expect(() => scheduler.enqueue({ taskId: "ok", projectId: "bad/project", priority: "normal" })).toThrow(/project id/);
    expect(() => scheduler.enqueue({ taskId: "ok-2", projectId: "p1", priority: "urgent" as never })).toThrow(/priority/);
    expect(() => scheduler.enqueue({ taskId: "ok-3", projectId: "finished", priority: "normal" })).toThrow(/archived/);
    expect(scheduler.pending()).toHaveLength(0);
  });

  it("queued items are deep immutable and never share caller arrays", () => {
    const { scheduler } = setup();
    const skills = ["shared-skill"];
    const item = scheduler.enqueue({ taskId: "frozen", projectId: "p1", priority: "normal", requiredSkills: skills });
    skills.push("injected");
    expect(item.requiredSkills).toEqual(["shared-skill"]);
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item.requiredSkills)).toBe(true);
  });

  it("does not exceed the project quota even when the global slot budget is larger", () => {
    const { scheduler, portfolio } = setup({ projects: [project("p1", "normal", 1)] });
    for (const task of ["a", "b", "c"]) scheduler.enqueue({ taskId: task, projectId: "p1", priority: "normal" });
    const result = scheduler.schedule(10);
    expect(result.assigned).toHaveLength(1);
    expect(portfolio.list()[0].activeTaskCount).toBe(1);
  });

  it("releases resources after cancel of an assigned task and ignores unknown completions", () => {
    const { scheduler, portfolio, allocator } = setup({ projects: [project("p1", "normal", 1)] });
    scheduler.enqueue({ taskId: "one", projectId: "p1", priority: "normal" });
    const assigned = scheduler.schedule(1).assigned;
    expect(assigned).toHaveLength(1);
    expect(scheduler.cancel("one")).toBe(false); // already running
    scheduler.complete("one", "cancelled");
    expect(allocator.isBusy("alice")).toBe(false);
    expect(portfolio.list()[0].activeTaskCount).toBe(0);
    scheduler.complete("ghost-task", "failed"); // silent no-op
    expect(scheduler.complete("one", "failed")).toBeUndefined(); // double finish is a no-op
    expect(allocator.activeAssignments()).toHaveLength(0);
  });

  it("deterministic order across several queued projects", () => {
    const { scheduler } = setup({ projects: [project("low-p", "low", 2), project("crit-p", "critical", 2), project("p1"), project("p2", "high", 2)] });
    scheduler.enqueue({ taskId: "normal-in-p1", projectId: "p1", priority: "normal" });
    scheduler.enqueue({ taskId: "crit-in-crit", projectId: "crit-p", priority: "normal" });
    scheduler.enqueue({ taskId: "normal-in-p2", projectId: "p2", priority: "normal" });
    scheduler.enqueue({ taskId: "normal-in-low", projectId: "low-p", priority: "normal" });
    const result = scheduler.schedule(2);
    expect(result.assigned.map(a => a.taskId)).toEqual(["crit-in-crit", "normal-in-p2"]);
    result.assigned.forEach(a => scheduler.complete(a.taskId, "completed"));
    const second = scheduler.schedule(2);
    expect(second.assigned.map(a => a.taskId)).toEqual(["normal-in-p1", "normal-in-low"]);
  });

  it("two interleaved dispatches (Promise.all) never double-assign employees or overshoot slots", async () => {
    const { scheduler, allocator } = setup({ employees: [employee("e1"), employee("e2")] });
    for (const task of ["t1", "t2", "t3", "t4"]) scheduler.enqueue({ taskId: task, projectId: "p1", priority: "normal" });
    // schedule() is synchronous and atomic within one event-loop turn: the two
    // awaits still land in invocation order without overlapping state mutation.
    const [first, second] = await Promise.all([Promise.resolve().then(() => scheduler.schedule(2)), Promise.resolve().then(() => scheduler.schedule(0))]);
    expect(first.assigned).toHaveLength(2);
    expect(second.assigned).toHaveLength(0);
    expect(new Set(allocator.activeAssignments().map(a => a.employeeId)).size).toBe(2);
    expect(allocator.activeAssignments().map(a => a.taskId).sort()).toEqual(["t1", "t2"]);
  });

  it("rollback primitives release both resources after a budget denial (S2-9 requirement)", () => {
    const { scheduler, portfolio, allocator } = setup();
    scheduler.enqueue({ taskId: "budget-denied", projectId: "p1", priority: "normal" });
    const [assignment] = scheduler.schedule(1).assigned;
    expect(assignment).toBeTruthy();
    // ... budget guard denies startTask(task) ...
    scheduler.complete(assignment.taskId, "failed");
    expect(allocator.isBusy(assignment.employeeId)).toBe(false);
    expect(portfolio.list().find(x => x.project.id === "p1")?.activeTaskCount).toBe(0);
    scheduler.enqueue({ taskId: "budget-denied", projectId: "p1", priority: "normal" });
    const retry = scheduler.schedule(1).assigned;
    expect(retry).toHaveLength(1);
    scheduler.complete(retry[0].taskId);
  });

  it("one employee across five projects: strictly one active assignment at a time", () => {
    const { scheduler, allocator } = setup({ projects: ["a", "b", "c", "d", "e"].map(id => project(id)), employees: [employee("solo")] });
    for (const p of ["a", "b", "c", "d", "e"]) scheduler.enqueue({ taskId: `task-${p}`, projectId: p, priority: "normal", employeeId: "solo" });
    expect(scheduler.schedule(10).assigned).toHaveLength(1);
    expect(allocator.activeAssignments().map(a => a.employeeId)).toEqual(["solo"]);
    scheduler.complete("task-a", "completed");
    expect(scheduler.schedule(10).assigned).toHaveLength(1);
    expect(allocator.isBusy("solo")).toBe(true);
  });

  it("five employees inside one project respect the project quota", () => {
    const { scheduler } = setup({ projects: [project("p1", "normal", 5)], employees: [1, 2, 3, 4, 5, 6].map(n => employee(`crew-${n}`)) });
    for (let index = 1; index <= 6; index += 1) scheduler.enqueue({ taskId: `job-${index}`, projectId: "p1", priority: "normal" });
    const result = scheduler.schedule(10);
    expect(result.assigned).toHaveLength(5);
    expect(result.pending).toHaveLength(1);
  });

  it("concurrent reserve attempts cannot exceed the project slot count", () => {
    const { portfolio } = setup({ projects: [project("quota", "normal", 3)] });
    const outcomes = ["t1", "t2", "t3", "t4"].map(taskId => portfolio.reserve("quota", taskId));
    expect(outcomes.filter(Boolean)).toHaveLength(3);
    for (const taskId of ["t1", "t2", "t3"]) portfolio.release("quota", taskId);
    expect(portfolio.list()[0].activeTaskCount).toBe(0);
  });
});
