import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  BudgetManager,
  BudgetStoreError,
  classifyExpense,
  DynamicSlotPolicy,
  JsonlCashPaymentStore,
  JsonlUsageStore,
  type BudgetGuardTaskRequest,
  type BudgetPolicyConfig,
  type CashPayment,
  type CashPaymentStore,
  type UsageEventInput,
  type UsageRecord,
  type UsageStore,
} from "../src/index.js";

const directories: string[] = [];
const NOW = "2026-11-15T12:00:00.000Z";

async function manager(policy: Partial<BudgetPolicyConfig> = {}): Promise<BudgetManager> {
  const directory = await mkdtemp(join(tmpdir(), "oao-s25-"));
  directories.push(directory);
  return new BudgetManager(new JsonlUsageStore(join(directory, "usage.jsonl")), {
    now: () => NOW,
    policy,
    paymentStore: new JsonlCashPaymentStore(join(directory, "payments.jsonl")),
  });
}

const chatgptUsage = (overrides: Partial<UsageEventInput> = {}): UsageEventInput => ({
  eventId: "sub-event",
  agentId: "director",
  modelId: "chatgpt-plus/synthetic",
  taskId: "task-1",
  input: 100,
  output: 40,
  reasoning: 10,
  cacheRead: 0,
  cacheWrite: 0,
  total: 150,
  costUsd: 0,
  timestamp: NOW,
  ...overrides,
});

const payment = (overrides: Partial<CashPayment> = {}): CashPayment => ({
  paymentId: "payment-1",
  amountRub: 250,
  timestamp: NOW,
  ...overrides,
});

afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true });
});

describe("provider spoofing resistance", () => {
  it("classification: an established provider dominates a declared category", () => {
    expect(classifyExpense({ taskId: "a", agentId: "x", modelId: "chatgpt-plus/model", expenseCategory: "free" })).toBe("subscription");
    expect(classifyExpense({ taskId: "b", agentId: "x", providerId: "chatgpt-plus", expenseCategory: "local" })).toBe("subscription");
    expect(classifyExpense({ taskId: "c", agentId: "x", modelId: "opencode-go/model", expenseCategory: "money" })).toBe("free");
    // Without provider evidence a declared category stays decisive.
    expect(classifyExpense({ taskId: "d", agentId: "x", expenseCategory: "free" })).toBe("free");
    expect(classifyExpense({ taskId: "e", agentId: "x" })).toBe("money");
  });

  it("rejects admission when providerId contradicts the modelId provider", async () => {
    const budget = await manager();
    const request: BudgetGuardTaskRequest = { taskId: "conflict", agentId: "developer", providerId: "opencode-go", modelId: "chatgpt-plus/synthetic" };
    const preview = await budget.checkTaskStart(request);
    expect(preview.allowed).toBe(false);
    await expect(budget.startTask(request)).rejects.toThrow(/conflicts/);
  });

  it("declared free category cannot bypass subscription limits for a chatgpt-plus model", async () => {
    const budget = await manager({ subscriptionRequestLimit: 1 });
    await budget.recordUsage(chatgptUsage());
    const preview = await budget.precheck({ taskId: "next", agentId: "director", modelId: "chatgpt-plus/synthetic", expenseCategory: "free" });
    expect(preview.category).toBe("subscription");
    expect(preview.allowed).toBe(false);
  });

  it("an unknown declared provider is never a silently permitted paid route", async () => {
    const budget = await manager();
    const request: BudgetGuardTaskRequest = { taskId: "vendor", agentId: "developer", modelId: "vendor-a/model" };
    const preview = await budget.precheck(request);
    expect(preview.allowed).toBe(false);
    expect(preview.category).toBe("money");
    await expect(budget.startTask(request)).rejects.toThrow(/unknown provider 'vendor-a'/);
    await expect(budget.startTask({ ...request, taskId: "vendor-free-ok", paidExternal: false })).resolves.toBeTruthy();
    await expect(budget.startTask({ ...request, taskId: "vendor-approved", allowPaidExternal: true }).then((handle) => handle.release())).resolves.toBeUndefined();
  });

  it("guard fields are validated: NaN context estimate cannot bypass limits", async () => {
    const budget = await manager({ subscriptionRequestLimit: 5, subscriptionContextTokensLimit: 300 });
    const summaryBefore = await budget.getUsageSummary();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      await expect(budget.checkTaskStart({ taskId: "t", agentId: "director", modelId: "chatgpt-plus/synthetic", estimatedContextTokens: bad })).rejects.toThrow(TypeError);
      await expect(budget.startTask({ taskId: "t", agentId: "director", modelId: "chatgpt-plus/synthetic", estimatedContextTokens: bad })).rejects.toThrow(TypeError);
    }
    await expect(budget.checkTaskStart({ taskId: "t", agentId: "director", expenseCategory: "bogus" as never })).rejects.toThrow(/expenseCategory/);
    await expect(budget.checkTaskStart({ taskId: "t", agentId: "director", providerId: "bad provider" })).rejects.toThrow(/providerId/);
    await expect(budget.checkTaskStart({ taskId: "t", agentId: "director", paidExternal: "yes" as never })).rejects.toThrow(/boolean/);
    const summaryAfter = await budget.getUsageSummary();
    expect(summaryAfter).toEqual(summaryBefore);
  });
});

describe("subscription limit boundaries", () => {
  it("blocks exactly when the configured request limit is reached", async () => {
    const budget = await manager({ subscriptionRequestLimit: 2 });
    await budget.recordUsage(chatgptUsage({ eventId: "req-1" }));
    expect((await budget.checkTaskStart({ taskId: "third-slot", agentId: "director", modelId: "chatgpt-plus/synthetic" })).allowed).toBe(true);
    await budget.recordUsage(chatgptUsage({ eventId: "req-2" }));
    const exhausted = await budget.checkTaskStart({ taskId: "over", agentId: "director", modelId: "chatgpt-plus/synthetic" });
    expect(exhausted.allowed).toBe(false);
    expect(/exhausted|request limit/.test(exhausted.reason)).toBe(true);
    // Free models are still admissible: an exhausted subscription must not
    // block independent providers without reason.
    expect((await budget.checkTaskStart({ taskId: "free-ok", agentId: "developer", modelId: "opencode-go/model" })).allowed).toBe(true);
  });

  it("blocks at the approx-context boundary and stays admissible below it", async () => {
    const budget = await manager({ subscriptionContextTokensLimit: 300 });
    await budget.recordUsage(chatgptUsage({ eventId: "ctx-1" }));
    expect((await budget.checkTaskStart({ taskId: "fit", agentId: "director", modelId: "chatgpt-plus/synthetic", estimatedContextTokens: 150 })).allowed).toBe(true);
    const over = await budget.checkTaskStart({ taskId: "over", agentId: "director", modelId: "chatgpt-plus/synthetic", estimatedContextTokens: 300 });
    expect(over.allowed).toBe(false);
  });

  it("keeps an unconfigured subscription unknown and does not mirror it over free work", async () => {
    const budget = await manager();
    const view = await budget.view();
    expect(view.subscription.status).toBe("unknown");
    expect(view.subscription.requestLimit).toBeNull();
    expect((await budget.checkTaskStart({ taskId: "ok", agentId: "developer", modelId: "opencode-go/model" })).allowed).toBe(true);
  });

  it("transitions between subscription periods without counting usage from outside the custom period", async () => {
    let current = "2026-11-15T12:00:00.000Z";
    const directory = await mkdtemp(join(tmpdir(), "oao-s25-periods-"));
    directories.push(directory);
    const budget = new BudgetManager(new JsonlUsageStore(join(directory, "usage.jsonl")), {
      now: () => current,
      policy: {
        subscriptionRequestLimit: 1,
        subscriptionPeriodStart: "2026-10-01T00:00:00.000Z",
        subscriptionPeriodEnd: "2026-12-01T00:00:00.000Z",
      },
      paymentStore: new JsonlCashPaymentStore(join(directory, "payments.jsonl")),
    });
    await budget.recordUsage(chatgptUsage({ eventId: "in-period", timestamp: "2026-11-02T00:00:00.000Z" }));
    expect((await budget.view()).subscription.status).toBe("blocked");
    // The custom period is user-configured and does not reset at the month boundary.
    current = "2026-12-02T00:00:00.000Z";
    expect((await budget.view()).subscription.status).toBe("blocked");
    expect((await budget.view()).subscription.requestsUsed).toBe(1);
  });
});

describe("dynamic slot policy hardening", () => {
  it("validates malformed inputs even while the policy is blocked", () => {
    const policy = new DynamicSlotPolicy();
    expect(() => policy.compute({ budgetStatus: "blocked", requestedTarget: -1 })).toThrow(TypeError);
    expect(() => policy.compute({ budgetStatus: "blocked", requestedTarget: 2.5 })).toThrow(TypeError);
    expect(() => policy.compute({ budgetStatus: "blocked", runtimeConcurrency: -3 })).toThrow(TypeError);
    expect(() => policy.compute({ budgetStatus: "blocked", runtimeConcurrency: 1.5 })).toThrow(TypeError);
    expect(() => policy.compute({ budgetStatus: "blocked" })).not.toThrow();
  });

  it("never exceeds the ceiling, the runtime cap or a positive floor", () => {
    const policy = new DynamicSlotPolicy();
    expect(policy.compute({ budgetStatus: "normal", requestedTarget: 100, runtimeConcurrency: 25 })).toMatchObject({ slots: 20 });
    expect(policy.compute({ budgetStatus: "normal", requestedTarget: 0, runtimeConcurrency: 5 }).slots).toBe(0);
    expect(policy.compute({ budgetStatus: "normal" })).toMatchObject({ slots: 2, baseline: 2, maximum: 20 });
    expect(policy.compute({ budgetStatus: "unknown" })).toMatchObject({ slots: 2 });
  });
});

describe("concurrent admission and idempotent release", () => {
  it("fills the last free slot once: two admitted, one rejected, counters exact", async () => {
    const budget = await manager({ maxConcurrentTasks: 2 });
    const results = await Promise.allSettled(["a", "b", "c"].map((taskId) => budget.startTask({ taskId, agentId: "developer" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(2);
    const fourth = await budget.checkTaskStart({ taskId: "d", agentId: "developer" });
    expect(fourth.allowed).toBe(false);
  });

  it("lets only one of two concurrent starts with the same taskId through", async () => {
    const budget = await manager();
    const [first, second] = await Promise.allSettled([budget.startTask({ taskId: "same", agentId: "developer" }), budget.startTask({ taskId: "same", agentId: "developer" })]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(BudgetExceededError);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(1);
    if (first.status === "fulfilled") first.value.release();
  });

  it("treats a repeated release as a no-op and keeps counters stable", async () => {
    const budget = await manager();
    const handle = await budget.startTask({ taskId: "released-twice", agentId: "developer" });
    handle.release();
    handle.release();
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });
});

describe("ledger resilience", () => {
  class FlakyUsageStore implements UsageStore {
    constructor(private readonly inner: JsonlUsageStore, private readFailures = 1) {}
    async appendUsage(record: UsageRecord): Promise<boolean> {
      return this.inner.appendUsage(record);
    }
    async readUsage(): Promise<UsageRecord[]> {
      if (this.readFailures > 0) {
        this.readFailures -= 1;
        throw new Error("simulated storage outage");
      }
      return this.inner.readUsage();
    }
  }

  it("fails explicitly on a ledger read outage, changes no counters, and recovers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oao-s25-outage-"));
    directories.push(directory);
    const store = new FlakyUsageStore(new JsonlUsageStore(join(directory, "usage.jsonl")));
    const manager = new BudgetManager(store, { now: () => NOW, paymentStore: new JsonlCashPaymentStore(join(directory, "payments.jsonl")) });
    await expect(manager.recordUsage(chatgptUsage())).rejects.toBeInstanceOf(BudgetStoreError);
    const empty = await manager.getUsageSummary();
    expect(empty.eventCount).toBe(0);
    await expect(manager.recordUsage(chatgptUsage())).resolves.toBeTruthy();
    expect((await manager.getUsageSummary()).eventCount).toBe(1);
  });

  it("does not double-count a derived usage event replayed after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oao-s25-restart-"));
    directories.push(directory);
    const paths = { usage: join(directory, "usage.jsonl"), payments: join(directory, "payments.jsonl") };
    const first = new BudgetManager(new JsonlUsageStore(paths.usage), { now: () => NOW, paymentStore: new JsonlCashPaymentStore(paths.payments) });
    const event = chatgptUsage({ eventId: undefined });
    await first.recordUsage(event);
    const second = new BudgetManager(new JsonlUsageStore(paths.usage), { now: () => NOW, paymentStore: new JsonlCashPaymentStore(paths.payments) });
    await second.recordUsage(event);
    expect((await second.getUsageSummary()).eventCount).toBe(1);
    expect((await second.view()).subscription.requestsUsed).toBe(1);
  });

  it("keeps counters unchanged when a payment journal write fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oao-s25-payfail-"));
    directories.push(directory);
    const failingStore: CashPaymentStore = {
      async appendPayment(): Promise<boolean> {
        throw new Error("simulated payment journal outage");
      },
      async readPayments(): Promise<CashPayment[]> {
        return [];
      },
    };
    const manager = new BudgetManager(new JsonlUsageStore(join(directory, "usage.jsonl")), { now: () => NOW, paymentStore: failingStore });
    await expect(manager.recordCashPayment(payment())).rejects.toBeInstanceOf(BudgetStoreError);
    expect(await manager.recordCashPayment(payment({ paymentId: "before", amountRub: 10 })).catch(() => "failed")).toBe("failed");
    // A working store on a separate path keeps working; the failed one wrote nothing.
    const working = await mkdtemp(join(tmpdir(), "oao-s25-paysuccess-"));
    directories.push(working);
    const healthy = new BudgetManager(new JsonlUsageStore(join(working, "usage.jsonl")), { now: () => NOW, paymentStore: new JsonlCashPaymentStore(join(working, "payments.jsonl")) });
    await healthy.recordCashPayment(payment({ paymentId: "healthy", amountRub: 40 }));
    expect((await healthy.getSnapshot()).extraSpendRub).toBe(40);
  });
});

describe("guard view accounting", () => {
  it("counts requestCountMonth by calendar month even for a custom subscription period", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oao-s25-view-"));
    directories.push(directory);
    const budget = new BudgetManager(new JsonlUsageStore(join(directory, "usage.jsonl")), {
      now: () => "2026-11-15T12:00:00.000Z",
      policy: { subscriptionPeriodStart: "2026-10-01T00:00:00.000Z", subscriptionPeriodEnd: "2026-11-01T00:00:00.000Z" },
      paymentStore: new JsonlCashPaymentStore(join(directory, "payments.jsonl")),
    });
    await budget.recordUsage(chatgptUsage({ eventId: "november", timestamp: "2026-11-05T00:00:00.000Z" }));
    await budget.recordUsage(chatgptUsage({ eventId: "october", timestamp: "2026-10-05T00:00:00.000Z" }));
    const view = await budget.view();
    expect(view.counts.requestCountMonth).toBe(1);
    expect(view.subscription.requestsUsed).toBe(1);
  });
});
