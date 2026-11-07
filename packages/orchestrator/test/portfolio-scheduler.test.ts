import { describe, expect, it } from "vitest";
import { ProjectPortfolio } from "../src/portfolio-manager.js";
import { ResourceAllocator, type DirectoryEmployeeSnapshot } from "../src/resource-allocator.js";
import { TaskScheduler } from "../src/scheduler.js";

const project = (id: string, priority: "low" | "normal" | "high" | "critical" = "normal", max = 2) => ({ id, name: id, rootDir: `/tmp/${id}`, status: "active" as const, portfolio: { priority, budgetShare: 0.2, maxConcurrentExecutions: max } });
const employees: readonly DirectoryEmployeeSnapshot[] = [
  { id: "alice", departmentId: "software", professionId: "backend", status: "active", availableSkillIds: ["typescript"], capabilityRequirements: ["code"] },
  { id: "bob", departmentId: "qa", professionId: "qa", status: "active", availableSkillIds: ["testing"], capabilityRequirements: ["code"] },
  { id: "offline", departmentId: "software", professionId: "backend", status: "disabled", availableSkillIds: ["typescript"], capabilityRequirements: ["code"] },
];
const setup = () => { const portfolio = new ProjectPortfolio(); portfolio.register(project("p1")); portfolio.register(project("p2", "high")); const allocator = new ResourceAllocator(employees, portfolio); return { portfolio, allocator, scheduler: new TaskScheduler(portfolio, allocator) }; };

describe("S2-7 portfolio, allocation and scheduling", () => {
  it("keeps projects isolated and orders interactive work deterministically", () => {
    const { scheduler } = setup();
    scheduler.enqueue({ taskId: "normal", projectId: "p1", priority: "normal", professionId: "backend" });
    scheduler.enqueue({ taskId: "interactive", projectId: "p2", priority: "interactive", professionId: "qa" });
    const result = scheduler.schedule(1);
    expect(result.assigned[0]).toMatchObject({ taskId: "interactive", projectId: "p2", employeeId: "bob" });
    expect(result.pending[0].projectId).toBe("p1");
  });

  it("uses FIFO for equal priorities and prevents double assignment", () => {
    const { scheduler, allocator } = setup();
    scheduler.enqueue({ taskId: "first", projectId: "p1", priority: "normal", employeeId: "alice" });
    scheduler.enqueue({ taskId: "second", projectId: "p1", priority: "normal", employeeId: "alice" });
    expect(scheduler.schedule(1).assigned[0].taskId).toBe("first");
    expect(scheduler.schedule(1).assigned).toHaveLength(0);
    expect(allocator.isBusy("alice")).toBe(true);
  });

  it("releases a resource after success or failure and supports queued cancellation", () => {
    const { scheduler, allocator } = setup();
    scheduler.enqueue({ taskId: "cancelled", projectId: "p1", priority: "normal" });
    expect(scheduler.cancel("cancelled")).toBe(true);
    scheduler.enqueue({ taskId: "run", projectId: "p1", priority: "normal", employeeId: "alice" });
    scheduler.schedule(1); scheduler.complete("run", "failed");
    expect(allocator.isBusy("alice")).toBe(false);
    scheduler.enqueue({ taskId: "again", projectId: "p2", priority: "normal", employeeId: "alice" });
    expect(scheduler.schedule(1).assigned[0].employeeId).toBe("alice");
  });

  it("rejects unavailable employees, unresolved skills and unavailable runtimes", () => {
    const { allocator } = setup();
    expect(allocator.allocate({ taskId: "disabled", projectId: "p1", priority: "normal", employeeId: "offline" })).toBeUndefined();
    expect(allocator.allocate({ taskId: "skill", projectId: "p1", priority: "normal", requiredSkills: ["planned-skill"] })).toBeUndefined();
    expect(allocator.allocate({ taskId: "runtime", projectId: "p1", priority: "normal", runtimeId: "missing" })).toBeUndefined();
  });

  it("computes baseline, ceiling, runtime limits and category-specific availability", () => {
    const { allocator } = setup();
    expect(allocator.computeTargetSlots({}).slots).toBe(2);
    expect(allocator.computeTargetSlots({ requestedTarget: 50, runtimeConcurrency: 3 }).slots).toBe(2);
    expect(allocator.computeTargetSlots({ requestedTarget: 10, runtimeConcurrency: 10, categoryAvailability: { subscription: false, free: true } }).slots).toBe(2);
    expect(allocator.computeTargetSlots({ requestedTarget: 10, runtimeConcurrency: 10, categoryAvailability: { subscription: false, free: false, local: false } }).slots).toBe(0);
    expect(allocator.computeTargetSlots({ requestedTarget: 50, runtimeConcurrency: 50, activeEmployeeCount: 50, categoryAvailability: { free: true } }).slots).toBe(20);
  });

  it("maintains project quotas and immutable portfolio snapshots", () => {
    const portfolio = new ProjectPortfolio(); portfolio.register(project("one", "critical", 1));
    expect(portfolio.reserve("one", "a")).toBe(true); expect(portfolio.reserve("one", "b")).toBe(false);
    const snapshot = portfolio.snapshot(); expect(() => (snapshot[0].project as { name: string }).name = "leak").toThrow();
    expect(portfolio.get("one").name).toBe("one"); portfolio.release("one", "a"); expect(portfolio.reserve("one", "b")).toBe(true);
  });
});
