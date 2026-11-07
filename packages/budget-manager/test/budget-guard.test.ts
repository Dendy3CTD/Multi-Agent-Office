import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BudgetManager,
  BudgetPolicyError,
  DynamicSlotPolicy,
  JsonlCashPaymentStore,
  JsonlUsageStore,
  type BudgetPolicyConfig,
  type UsageEventInput,
} from "../src/index.js";

const directories: string[] = [];
const now = "2026-11-15T12:00:00.000Z";

async function manager(policy: Partial<BudgetPolicyConfig> = {}): Promise<BudgetManager> {
  const directory = await mkdtemp(join(tmpdir(), "oao-budget-guard-"));
  directories.push(directory);
  return new BudgetManager(new JsonlUsageStore(join(directory, "usage.jsonl")), {
    now: () => now,
    policy,
    paymentStore: new JsonlCashPaymentStore(join(directory, "payments.jsonl")),
  });
}

function usage(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
  return {
    eventId: "subscription-event-1",
    agentId: "director",
    modelId: "chatgpt-plus/synthetic",
    taskId: "task-1",
    input: 100,
    output: 50,
    reasoning: 10,
    cacheRead: 0,
    cacheWrite: 0,
    total: 160,
    costUsd: 0,
    timestamp: now,
    ...overrides,
  };
}

afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true });
});

describe("Budget Guard classification and policy", () => {
  it("classifies free, subscription, local and money without provider calls", async () => {
    const budget = await manager();
    expect(budget.classify({ taskId: "a", agentId: "x", modelId: "opencode-go/model" })).toBe("free");
    expect(budget.classify({ taskId: "b", agentId: "x", modelId: "chatgpt-plus/model" })).toBe("subscription");
    expect(budget.classify({ taskId: "c", agentId: "x", modelId: "local/model" })).toBe("local");
    expect(budget.classify({ taskId: "d", agentId: "x", modelId: "vendor/model" })).toBe("money");
    expect(budget.classify({ taskId: "e", agentId: "x", expenseCategory: "free" })).toBe("free");
  });

  it("precheck is read-only and returns transparent category/view", async () => {
    const budget = await manager({ maxConcurrentTasks: 1 });
    const before = await budget.getSnapshot();
    const decision = await budget.precheck({ taskId: "preview", agentId: "developer", modelId: "opencode-go/model" });
    const after = await budget.getSnapshot();
    expect(decision.allowed).toBe(true);
    expect(decision.category).toBe("free");
    expect(decision.reason).toContain("within configured");
    expect(decision.guardView.counts.activeExecutions).toBe(0);
    expect(after.activeTaskCount).toBe(before.activeTaskCount);
  });

  it("blocks paid external execution without approval and permits explicit approval only", async () => {
    const budget = await manager({ extraUsageEnabled: true });
    const rejected = await budget.precheck({ taskId: "paid", agentId: "developer", modelId: "vendor/model", paidExternal: true });
    expect(rejected.allowed).toBe(false);
    expect(rejected.reason).toContain("explicit user approval");
    const approved = await budget.precheck({ taskId: "paid-approved", agentId: "developer", modelId: "vendor/model", paidExternal: true, allowPaidExternal: true });
    expect(approved.allowed).toBe(true);
  });

  it("rejects invalid subscription policy and keeps the 2000 RUB ceiling explicit", () => {
    expect(() => new BudgetManager(new JsonlUsageStore("/tmp/oao-guard-invalid.jsonl"), { policy: { subscriptionRequestLimit: 0 } })).toThrow(BudgetPolicyError);
    expect(() => new BudgetManager(new JsonlUsageStore("/tmp/oao-guard-over-budget.jsonl"), { policy: { monthlyBudgetRub: 2001 } })).toThrow(BudgetPolicyError);
    expect(() => new BudgetManager(new JsonlUsageStore("/tmp/oao-guard-invalid-period.jsonl"), { policy: { subscriptionPeriodStart: now } })).toThrow(BudgetPolicyError);
  });
});

describe("subscription limits and recovery", () => {
  it("tracks request count and approximate context, without treating it as API balance", async () => {
    const budget = await manager({ subscriptionRequestLimit: 2, subscriptionContextTokensLimit: 300 });
    await budget.recordUsage(usage());
    const view = await budget.view();
    expect(view.subscription.requestsUsed).toBe(1);
    expect(view.subscription.approxContextTokensUsed).toBe(160);
    expect(view.subscription.status).toBe("available");
    expect(view.money.spentRub).toBe(1000); // fixed subscription payment is money; usage remains subscription policy, not API balance
    expect((await budget.getSnapshot()).allowanceStatus).toBe("unknown");
    const rejected = await budget.precheck({ taskId: "next", agentId: "director", modelId: "chatgpt-plus/synthetic", estimatedContextTokens: 200 });
    expect(rejected.allowed).toBe(false);
    expect(rejected.reason).toContain("approximate context");
  });

  it("blocks an exhausted request limit and reloads the same snapshot from JSONL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oao-budget-recovery-"));
    directories.push(directory);
    const options = { now: () => now, policy: { subscriptionRequestLimit: 1 }, paymentStore: new JsonlCashPaymentStore(join(directory, "payments.jsonl")) };
    const first = new BudgetManager(new JsonlUsageStore(join(directory, "usage.jsonl")), options);
    await first.recordUsage(usage());
    expect((await first.view()).subscription.status).toBe("blocked");
    const second = new BudgetManager(new JsonlUsageStore(join(directory, "usage.jsonl")), options);
    expect((await second.getSnapshot()).subscriptionUsage?.requestsUsed).toBe(1);
    expect((await second.precheck({ taskId: "blocked", agentId: "director", modelId: "chatgpt-plus/synthetic" })).allowed).toBe(false);
  });

  it("keeps repeated identical usage idempotent and does not double-count guard views", async () => {
    const budget = await manager({ subscriptionRequestLimit: 5 });
    const event = usage();
    await budget.recordUsage(event);
    await budget.recordUsage(event);
    expect((await budget.view()).subscription.requestsUsed).toBe(1);
    expect((await budget.getUsageSummary()).eventCount).toBe(1);
  });
});

describe("atomic admission and dynamic slots", () => {
  it("keeps precheck non-reserving while startTask remains the only slot reservation", async () => {
    const budget = await manager({ maxConcurrentTasks: 2 });
    await Promise.all([budget.precheck({ taskId: "p1", agentId: "a" }), budget.precheck({ taskId: "p2", agentId: "b" })]);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
    const handles = await Promise.all([budget.startTask({ taskId: "a", agentId: "a" }), budget.startTask({ taskId: "b", agentId: "b" })]);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(2);
    handles.forEach((handle) => handle.release());
  });

  it("computes capacity from baseline, policy, budget and runtime ceiling", async () => {
    const budget = await manager();
    expect(budget.computeSlotPolicy({ budgetStatus: "normal" })).toMatchObject({ slots: 2, baseline: 2, maximum: 20 });
    expect(budget.computeSlotPolicy({ budgetStatus: "normal", requestedTarget: 50, runtimeConcurrency: 3 }).slots).toBe(3);
    expect(budget.computeSlotPolicy({ budgetStatus: "blocked", requestedTarget: 20 }).slots).toBe(0);
    expect(() => new DynamicSlotPolicy().compute({ budgetStatus: "normal", requestedTarget: -1 })).toThrow(TypeError);
  });
});
