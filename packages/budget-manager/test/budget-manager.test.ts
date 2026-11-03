import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BudgetExceededError,
  BudgetManager,
  BudgetPolicyError,
  BudgetStoreError,
  CashPaymentConflictError,
  JsonlCashPaymentStore,
  JsonlUsageStore,
  UsageLedger,
  currentAccountingPeriod,
  monthAccountingPeriod,
  type BudgetPolicyConfig,
  type CashPayment,
  type UsageRecord,
} from "../src/index";

const baseEvent = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  eventId: "event-1",
  agentId: "developer",
  modelId: "opencode-go/claude-haiku-5-5",
  taskId: "task-1",
  projectId: "project-1",
  sessionId: "session-1",
  timestamp: "2026-11-02T10:00:00.000Z",
  input: 100,
  output: 50,
  reasoning: 10,
  cacheRead: 5,
  cacheWrite: 2,
  total: 160,
  costUsd: 0.25,
  ...overrides,
});

const payment = (overrides: Partial<CashPayment> = {}): CashPayment => ({
  paymentId: "payment-1",
  amountRub: 250,
  timestamp: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

const directories: string[] = [];

async function temporaryDirectory(): Promise<{ usagePath: string; paymentPath: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "oao-budget-"));
  directories.push(directory);
  return { directory, usagePath: join(directory, "usage.jsonl"), paymentPath: join(directory, "payments.jsonl") };
}

function managerFor(paths: { usagePath: string; paymentPath: string }, options: { now?: () => string; policy?: Partial<BudgetPolicyConfig> } = {}): BudgetManager {
  return new BudgetManager(new JsonlUsageStore(paths.usagePath), { ...options, paymentStore: new JsonlCashPaymentStore(paths.paymentPath) });
}

/** Mutable injected clock: `set` moves logical time without waiting. */
function clockAt(initial: string): { now: () => string; set: (value: string) => void } {
  let current = initial;
  return { now: () => current, set: (value) => { current = value; } };
}

afterEach(async () => {
  vi.useRealTimers();
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true });
});

describe("Budget Manager", () => {
  it("accounts one event, sums usage, and groups by agent/model/project/task/session", async () => {
    const { usagePath } = await temporaryDirectory();
    const manager = new BudgetManager(new JsonlUsageStore(usagePath));
    await manager.recordUsage(baseEvent());
    await manager.recordUsage(baseEvent({ eventId: "event-2", agentId: "analyst", modelId: "opencode-go/mimo-v2.6-flash", taskId: "task-2", projectId: "project-2", sessionId: "session-2", costUsd: 0.5, total: 200 }));
    const summary = await manager.getUsageSummary();
    expect(summary.eventCount).toBe(2);
    expect(summary.input).toBe(200);
    expect(summary.costUsd).toBe(0.75);
    expect(summary.byAgent.developer.eventCount).toBe(1);
    expect(summary.byAgent.analyst.costUsd).toBe(0.5);
    expect(summary.byModel["opencode-go/mimo-v2.6-flash"].eventCount).toBe(1);
    expect(summary.byProject["project-2"].eventCount).toBe(1);
    expect(summary.byTask["task-1"].eventCount).toBe(1);
    expect(summary.bySession["session-2"].eventCount).toBe(1);
  });

  it("deduplicates explicit and derived usage IDs, including concurrent writes", async () => {
    const { usagePath } = await temporaryDirectory();
    const store = new JsonlUsageStore(usagePath);
    const record = baseEvent();
    expect(await store.appendUsage(record)).toBe(true);
    expect(await store.appendUsage(record)).toBe(false);
    const other = baseEvent({ eventId: "event-2" });
    expect((await Promise.all([store.appendUsage(other), store.appendUsage(other)])).filter(Boolean)).toHaveLength(1);
    expect(await store.readUsage()).toHaveLength(2);
  });

  it("calculates current-month statistics and keeps USD reported cost separate from RUB payments", async () => {
    const paths = await temporaryDirectory();
    const manager = managerFor(paths, { now: () => "2026-11-15T12:00:00.000Z", policy: { subscriptionCostRub: 700 } });
    await manager.recordUsage(baseEvent({ timestamp: "2026-11-01T00:00:00.000Z", costUsd: 2 }));
    await manager.recordUsage(baseEvent({ eventId: "old", timestamp: "2026-10-31T23:59:59.000Z", costUsd: 100 }));
    await manager.recordCashPayment(payment({ paymentId: "payment-1", amountRub: 250 }));
    const month = await manager.getMonthlySummary();
    const snapshot = await manager.getSnapshot();
    expect(month.eventCount).toBe(1);
    expect(snapshot.reportedUsageUsd).toBe(2);
    expect(snapshot.actualSpendRub).toBe(950);
    expect(snapshot.extraBudgetRub).toBe(300);
    expect(snapshot.extraSpendRub).toBe(250);
    expect(snapshot.extraBudgetRemainingRub).toBe(50);
    expect(snapshot.status).toBe("warning");
    expect(snapshot.allowanceStatus).toBe("unknown");
  });

  it("returns unknown without a manually entered payment and never invents Go allowance", async () => {
    const paths = await temporaryDirectory();
    const manager = managerFor(paths, { policy: { subscriptionCostRub: null } });
    const snapshot = await manager.getSnapshot();
    expect(snapshot.actualSpendRub).toBeNull();
    expect(snapshot.status).toBe("unknown");
    expect(snapshot.allowanceStatus).toBe("unknown");
  });

  it("treats the subscription as included quota and applies warning/critical/blocked to extra RUB payments only", async () => {
    const make = async (amount: number) => {
      const paths = await temporaryDirectory();
      const manager = managerFor(paths, { policy: { subscriptionCostRub: 0 } });
      if (amount > 0) await manager.recordCashPayment(payment({ paymentId: `payment-${amount}`, amountRub: amount }));
      return (await manager.getSnapshot()).status;
    };
    expect(await make(0)).toBe("normal");
    expect(await make(699)).toBe("normal");
    expect(await make(700)).toBe("warning");
    expect(await make(900)).toBe("critical");
    expect(await make(1000)).toBe("blocked");
  });

  it("uses the default policy: 1000 RUB subscription, 0 RUB extra budget, quota tasks allowed, extra spend denied", async () => {
    const manager = managerFor(await temporaryDirectory());
    expect(manager.policy.subscriptionCostRub).toBe(1000);
    expect(manager.policy.monthlyBudgetRub).toBe(1000);
    expect(manager.policy.extraUsageEnabled).toBe(false);
    const snapshot = await manager.getSnapshot();
    expect(snapshot.actualSpendRub).toBe(1000);
    expect(snapshot.extraBudgetRub).toBe(0);
    expect(snapshot.extraSpendRub).toBe(0);
    expect(snapshot.extraBudgetRemainingRub).toBe(0);
    expect(snapshot.status).toBe("normal");
    expect(snapshot.allowanceStatus).toBe("unknown");
    expect((await manager.checkTaskStart({ taskId: "quota-task", agentId: "developer", estimatedTotalTokens: 1000 })).allowed).toBe(true);
    const extra = await manager.checkTaskStart({ taskId: "extra-task", agentId: "developer", requiresExtraSpend: true });
    expect(extra.allowed).toBe(false);
    expect(extra.reason).toContain("extra usage spending is disabled");
  });

  it("checks hard budget, extra spend policy and concurrent task limit", async () => {
    const paths = await temporaryDirectory();
    const manager = managerFor(paths, { policy: { maxConcurrentTasks: 1, subscriptionCostRub: null } });
    const first = await manager.startTask({ taskId: "first", agentId: "developer" });
    const concurrent = await manager.checkTaskStart({ taskId: "second", agentId: "analyst" });
    expect(concurrent.allowed).toBe(false);
    expect(concurrent.reason).toContain("concurrent");
    first.release();
    const blockedManager = managerFor({ usagePath: join(paths.directory, "blocked.jsonl"), paymentPath: join(paths.directory, "blocked-payments.jsonl") }, { policy: { subscriptionCostRub: 1000 } });
    await blockedManager.recordCashPayment(payment({ paymentId: "extra-1", amountRub: 1 }));
    const blocked = await blockedManager.checkTaskStart({ taskId: "second", agentId: "analyst" });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("extra budget");
    const extra = managerFor({ usagePath: join(paths.directory, "extra.jsonl"), paymentPath: join(paths.directory, "extra-payments.jsonl") }, { policy: { extraUsageEnabled: false } });
    expect((await extra.checkTaskStart({ taskId: "extra", agentId: "developer", requiresExtraSpend: true })).allowed).toBe(false);
  });

  it("enforces task, agent, token and duration limits and aborts active work", async () => {
    const manager = managerFor(await temporaryDirectory(), { now: () => "2026-11-02T10:00:00.000Z", policy: { maxReportedCostUsdPerTask: 1, maxTotalTokensPerTask: 100, maxOutputTokensPerTask: 40, maxReasoningTokensPerTask: 20, maxTaskDurationMs: 1000, agentLimits: { developer: { maxReportedCostUsd: 2, maxTotalTokens: 200 } } } });
    const handle = await manager.startTask({ taskId: "task-1", agentId: "developer", estimatedCostUsd: 0.5 });
    await expect(manager.recordUsage(baseEvent({ costUsd: 1.1, total: 101, output: 41, reasoning: 21 }))).rejects.toBeInstanceOf(BudgetExceededError);
    expect(handle.abortController.signal.aborted).toBe(true);
    handle.release();
    const tooExpensive = await manager.checkTaskStart({ taskId: "task-2", agentId: "developer", estimatedCostUsd: 2 });
    expect(tooExpensive.allowed).toBe(false);
    const tooLong = await manager.checkTaskStart({ taskId: "task-3", agentId: "developer", estimatedDurationMs: 1001 });
    expect(tooLong.allowed).toBe(false);
  });

  it("writes JSONL, reloads it, skips damaged lines, and stores no prompts or secrets", async () => {
    const { usagePath } = await temporaryDirectory();
    const store = new JsonlUsageStore(usagePath);
    await store.appendUsage(baseEvent({ eventId: "safe-event" }));
    await writeFile(usagePath, `${await readFile(usagePath, "utf8")}not-json\n`, "utf8");
    const reloaded = await new JsonlUsageStore(usagePath).readUsage();
    expect(reloaded).toHaveLength(1);
    const raw = await readFile(usagePath, "utf8");
    expect(raw).not.toContain("private prompt");
    expect(raw).not.toContain("api-secret");
    expect(raw).toContain("safe-event");
  });

  it("validates policy and usage metrics", async () => {
    expect(() => new BudgetManager(new JsonlUsageStore("/tmp/oao-budget-validation.jsonl"), { policy: { warningThreshold: 1.2 } })).toThrow(BudgetPolicyError);
    expect(() => new BudgetManager(new JsonlUsageStore("/tmp/oao-budget-validation.jsonl"), { policy: { subscriptionCostRub: 1500 } })).toThrow(BudgetPolicyError);
    const manager = new BudgetManager(new JsonlUsageStore((await temporaryDirectory()).usagePath));
    await expect(manager.recordUsage(baseEvent({ input: -1 }))).rejects.toThrow(TypeError);
  });

  it("supports direct ledger aggregation without storage", () => {
    const ledger = new UsageLedger([baseEvent(), baseEvent({ eventId: "other", agentId: "engineer", costUsd: 1 })]);
    expect(ledger.summarize({ agentId: "engineer" }).costUsd).toBe(1);
    expect(ledger.summarize({ from: "2026-12-01T00:00:00.000Z" }).eventCount).toBe(0);
  });

  describe("cash payment journal", () => {
    it("persists payments to a JSONL file with whitelisted fields only", async () => {
      const paths = await temporaryDirectory();
      const manager = managerFor(paths, { now: () => "2026-11-15T12:00:00.000Z" });
      await manager.recordCashPayment({ ...payment(), description: "api-secret token=xyz private prompt" } as CashPayment);
      const raw = await readFile(paths.paymentPath, "utf8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual({ paymentId: "payment-1", amountRub: 250, timestamp: "2026-11-01T00:00:00.000Z" });
      expect(raw).not.toContain("api-secret");
      expect(raw).not.toContain("private prompt");
    });

    it("restores payments after a new BudgetManager instance is created", async () => {
      const paths = await temporaryDirectory();
      const first = managerFor(paths, { now: () => "2026-11-15T12:00:00.000Z", policy: { subscriptionCostRub: 0 } });
      await first.recordCashPayment(payment({ amountRub: 300 }));
      const restarted = managerFor(paths, { now: () => "2026-11-15T12:00:00.000Z", policy: { subscriptionCostRub: 0 } });
      const payments = await restarted.getCashPayments();
      expect(payments).toEqual([payment({ amountRub: 300 })]);
      expect((await restarted.getSnapshot()).extraSpendRub).toBe(300);
    });

    it("deduplicates identical repeats without increasing spend", async () => {
      const paths = await temporaryDirectory();
      const manager = managerFor(paths, { now: () => "2026-11-15T12:00:00.000Z", policy: { subscriptionCostRub: 0 } });
      await manager.recordCashPayment(payment({ amountRub: 300 }));
      await manager.recordCashPayment(payment({ amountRub: 300 }));
      await new BudgetManager(new JsonlUsageStore(paths.usagePath), { paymentStore: new JsonlCashPaymentStore(paths.paymentPath) }).recordCashPayment(payment({ amountRub: 300 }));
      expect(await manager.getCashPayments()).toHaveLength(1);
      expect((await manager.getSnapshot()).extraSpendRub).toBe(300);
      expect((await readFile(paths.paymentPath, "utf8")).trim().split("\n")).toHaveLength(1);
    });

    it("rejects the same paymentId with different data and leaves the journal unchanged", async () => {
      const paths = await temporaryDirectory();
      const manager = managerFor(paths, { now: () => "2026-11-15T12:00:00.000Z" });
      await manager.recordCashPayment(payment({ amountRub: 250 }));
      const before = await readFile(paths.paymentPath, "utf8");
      await expect(manager.recordCashPayment(payment({ amountRub: 999 }))).rejects.toBeInstanceOf(CashPaymentConflictError);
      expect(await readFile(paths.paymentPath, "utf8")).toBe(before);
      expect((await manager.getCashPayments())[0].amountRub).toBe(250);
    });

    it("skips damaged, invalid and partially written payment lines", async () => {
      const paths = await temporaryDirectory();
      const valid = JSON.stringify(payment({ paymentId: "good", amountRub: 40 }));
      const content = [
        "{not json",
        JSON.stringify({ paymentId: "bad-amount", amountRub: "NaN", timestamp: "2026-11-01T00:00:00.000Z" }),
        JSON.stringify({ paymentId: "bad-date", amountRub: 5, timestamp: "yesterday" }),
        JSON.stringify({ paymentId: "bad id with spaces", amountRub: 5, timestamp: "2026-11-01T00:00:00.000Z" }),
        "null",
        valid,
        '{"paymentId":"cut-off","amountRub":7,"timestamp":"2026-11-0',
      ].join("\n");
      await writeFile(paths.paymentPath, `${content}\n`, "utf8");
      const payments = await new JsonlCashPaymentStore(paths.paymentPath).readPayments();
      expect(payments).toEqual([payment({ paymentId: "good", amountRub: 40 })]);
    });

    it("appends after a partially written line without gluing the new record onto it", async () => {
      const paths = await temporaryDirectory();
      await writeFile(paths.paymentPath, '{"paymentId":"cut-off","amountRub":7,"timestamp":"2026-11-0', "utf8");
      const manager = managerFor(paths, { now: () => "2026-11-15T12:00:00.000Z" });
      await manager.recordCashPayment(payment({ paymentId: "after-crash", amountRub: 60 }));
      const restored = await new JsonlCashPaymentStore(paths.paymentPath).readPayments();
      expect(restored).toEqual([payment({ paymentId: "after-crash", amountRub: 60 })]);
    });

    it("refuses to load a journal that contains conflicting records for one paymentId", async () => {
      const paths = await temporaryDirectory();
      await writeFile(paths.paymentPath, `${JSON.stringify(payment({ amountRub: 1 }))}\n${JSON.stringify(payment({ amountRub: 2 }))}\n`, "utf8");
      await expect(new JsonlCashPaymentStore(paths.paymentPath).readPayments()).rejects.toBeInstanceOf(CashPaymentConflictError);
    });

    it("serializes concurrent appends of different payments within one process", async () => {
      const paths = await temporaryDirectory();
      const store = new JsonlCashPaymentStore(paths.paymentPath);
      const payments = Array.from({ length: 10 }, (_, index) => payment({ paymentId: `p-${index}`, amountRub: index + 1 }));
      await Promise.all(payments.map((item) => store.appendPayment(item)));
      const restored = await new JsonlCashPaymentStore(paths.paymentPath).readPayments();
      expect(restored).toHaveLength(10);
      expect(restored.reduce((sum, item) => sum + item.amountRub, 0)).toBe(55);
    });

    it("requires an absolute journal path", () => {
      expect(() => new JsonlCashPaymentStore("relative/payments.jsonl")).toThrow(TypeError);
    });

    it("fails explicitly instead of keeping payments in memory when no store is configured", async () => {
      const manager = new BudgetManager(new JsonlUsageStore((await temporaryDirectory()).usagePath));
      await expect(manager.recordCashPayment(payment())).rejects.toThrow(/not configured/);
      await expect(manager.getCashPayments()).rejects.toBeInstanceOf(BudgetStoreError);
      await expect(manager.getSnapshot()).rejects.toThrow(/not configured/);
      await expect(manager.startTask({ taskId: "task-1", agentId: "developer" })).rejects.toThrow(/not configured/);
      // Usage accounting does not depend on the payment store.
      await expect(manager.recordUsage(baseEvent())).resolves.toMatchObject({ taskId: "task-1" });
    });
  });

  describe("calendar-month accounting", () => {
    it("counts only current-month payments and keeps historical records", async () => {
      const paths = await temporaryDirectory();
      const clock = clockAt("2026-11-15T12:00:00.000Z");
      const manager = managerFor(paths, { now: clock.now, policy: { subscriptionCostRub: 0 } });
      await manager.recordCashPayment(payment({ paymentId: "october", amountRub: 400, timestamp: "2026-10-10T10:00:00.000Z" }));
      await manager.recordCashPayment(payment({ paymentId: "november", amountRub: 100, timestamp: "2026-11-03T10:00:00.000Z" }));
      const snapshot = await manager.getSnapshot();
      expect(snapshot.extraSpendRub).toBe(100);
      expect(snapshot.status).toBe("normal");
      expect(await manager.getCashPayments()).toHaveLength(2);
    });

    it("does not let a previous month's payment block the new month", async () => {
      const paths = await temporaryDirectory();
      const clock = clockAt("2026-10-20T12:00:00.000Z");
      const manager = managerFor(paths, { now: clock.now });
      await manager.recordCashPayment(payment({ amountRub: 1000, timestamp: "2026-10-20T11:00:00.000Z" }));
      expect((await manager.checkTaskStart({ taskId: "oct-task", agentId: "developer" })).allowed).toBe(false);
      clock.set("2026-11-01T00:00:00.000Z");
      const snapshot = await manager.getSnapshot();
      expect(snapshot.status).toBe("normal");
      expect(snapshot.extraSpendRub).toBe(0);
      expect((await manager.checkTaskStart({ taskId: "nov-task", agentId: "developer" })).allowed).toBe(true);
    });

    it("rolls over December to January in UTC, including the exact boundary instant", async () => {
      const paths = await temporaryDirectory();
      const clock = clockAt("2026-12-31T23:59:59.999Z");
      const manager = managerFor(paths, { now: clock.now });
      await manager.recordCashPayment(payment({ amountRub: 1000, timestamp: "2026-12-31T23:30:00.000Z" }));
      expect((await manager.getSnapshot()).status).toBe("blocked");
      clock.set("2027-01-01T00:00:00.000Z");
      const january = await manager.getSnapshot();
      expect(january.status).toBe("normal");
      expect(january.extraSpendRub).toBe(0);
      expect(january.monthlyUsage.eventCount).toBe(0);
      expect(await manager.getCashPayments()).toHaveLength(1);
    });

    it("sums a month of usage without counting the previous month's events", async () => {
      const paths = await temporaryDirectory();
      const clock = clockAt("2026-12-15T12:00:00.000Z");
      const manager = managerFor(paths, { now: clock.now });
      await manager.recordUsage(baseEvent({ eventId: "dec", timestamp: "2026-12-01T00:00:00.000Z", costUsd: 3 }));
      await manager.recordUsage(baseEvent({ eventId: "nov", timestamp: "2026-11-30T23:59:59.999Z", costUsd: 7 }));
      expect((await manager.getSnapshot()).reportedUsageUsd).toBe(3);
      expect((await manager.getMonthlySummary("2026-11")).costUsd).toBe(7);
    });

    it("uses the configured accounting time zone for month boundaries", async () => {
      // 21:30 UTC on Oct 31 is 00:30 on Nov 1 in Moscow (UTC+3, no DST).
      const instant = "2026-10-31T21:30:00.000Z";
      const utcPaths = await temporaryDirectory();
      const utc = managerFor(utcPaths, { now: () => "2026-11-01T10:00:00.000Z", policy: { subscriptionCostRub: 0 } });
      await utc.recordCashPayment(payment({ amountRub: 1000, timestamp: instant }));
      expect((await utc.getSnapshot()).extraSpendRub).toBe(0);

      const moscowPaths = await temporaryDirectory();
      const moscow = managerFor(moscowPaths, { now: () => "2026-11-01T10:00:00.000Z", policy: { subscriptionCostRub: 0, accountingTimeZone: "Europe/Moscow" } });
      await moscow.recordCashPayment(payment({ amountRub: 1000, timestamp: instant }));
      const snapshot = await moscow.getSnapshot();
      expect(snapshot.extraSpendRub).toBe(1000);
      expect(snapshot.status).toBe("blocked");
    });

    it("computes period bounds for UTC, a DST-free zone and December", () => {
      expect(currentAccountingPeriod("2026-12-31T23:59:59.999Z", "UTC")).toEqual({ month: "2026-12", from: "2026-12-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" });
      expect(monthAccountingPeriod("2026-11", "Europe/Moscow")).toEqual({ month: "2026-11", from: "2026-10-31T21:00:00.000Z", to: "2026-11-30T21:00:00.000Z" });
      expect(currentAccountingPeriod("2027-01-01T00:00:00.000Z", "Europe/Moscow").month).toBe("2027-01");
      expect(() => monthAccountingPeriod("2026-13", "UTC")).toThrow(RangeError);
    });

    it("rejects an unknown accounting time zone", () => {
      expect(() => new BudgetManager(new JsonlUsageStore("/tmp/oao-budget-tz.jsonl"), { policy: { accountingTimeZone: "Mars/Olympus" } })).toThrow(BudgetPolicyError);
    });

    it("applies per-agent limits to the current month only", async () => {
      const paths = await temporaryDirectory();
      const clock = clockAt("2026-12-21T10:00:00.000Z");
      const manager = managerFor(paths, { now: clock.now, policy: { agentLimits: { developer: { maxReportedCostUsd: 2 } } } });
      await manager.recordUsage(baseEvent({ eventId: "dec-spend", timestamp: "2026-12-20T10:00:00.000Z", costUsd: 5 }));
      await expect(manager.checkTaskStart({ taskId: "dec-task", agentId: "developer", estimatedCostUsd: 0.5 })).resolves.toMatchObject({ allowed: false });
      clock.set("2027-01-02T10:00:00.000Z");
      expect((await manager.checkTaskStart({ taskId: "jan-task", agentId: "developer", estimatedCostUsd: 0.5 })).allowed).toBe(true);
      await manager.recordUsage(baseEvent({ eventId: "jan-spend", timestamp: "2027-01-02T11:00:00.000Z", costUsd: 1.5 }));
      expect((await manager.checkTaskStart({ taskId: "jan-task-2", agentId: "developer", estimatedCostUsd: 0.6 })).allowed).toBe(false);
      expect((await manager.checkTaskStart({ taskId: "jan-task-3", agentId: "developer", estimatedCostUsd: 0.5 })).allowed).toBe(true);
    });
  });

  describe("admission lock", () => {
    it("never exceeds maxConcurrentTasks under parallel startTask calls", async () => {
      const manager = managerFor(await temporaryDirectory(), { policy: { maxConcurrentTasks: 1 } });
      const results = await Promise.allSettled(["a", "b", "c", "d", "e"].map((id) => manager.startTask({ taskId: id, agentId: "developer" })));
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<BudgetManager["startTask"]>>> => result.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(4);
      expect((await manager.getSnapshot()).activeTaskCount).toBe(1);
      fulfilled[0].value.release();
    });

    it("checkTaskStart is a preview and does not reserve a slot", async () => {
      const manager = managerFor(await temporaryDirectory(), { policy: { maxConcurrentTasks: 1 } });
      expect((await manager.checkTaskStart({ taskId: "preview", agentId: "developer" })).allowed).toBe(true);
      expect((await manager.getSnapshot()).activeTaskCount).toBe(0);
      const handle = await manager.startTask({ taskId: "real", agentId: "developer" });
      handle.release();
    });

    it("orders a payment and a task start that race each other deterministically", async () => {
      // Extra budget is 1000 RUB; a 1000 RUB payment blocks every new task.
      const paths = await temporaryDirectory();
      const manager = managerFor(paths, { policy: { subscriptionCostRub: 0 } });
      const startFirst = manager.startTask({ taskId: "before-payment", agentId: "developer" });
      const payFirst = manager.recordCashPayment(payment({ amountRub: 1000 }));
      const [started, paid] = await Promise.allSettled([startFirst, payFirst]);
      expect(started.status).toBe("fulfilled");
      expect(paid.status).toBe("fulfilled");
      if (started.status === "fulfilled") started.value.release();

      const other = managerFor({ usagePath: join(paths.directory, "u2.jsonl"), paymentPath: join(paths.directory, "p2.jsonl") }, { policy: { subscriptionCostRub: 0 } });
      const payThenStart = other.recordCashPayment(payment({ amountRub: 1000 }));
      const blockedStart = other.startTask({ taskId: "after-payment", agentId: "developer" });
      const [paid2, start2] = await Promise.allSettled([payThenStart, blockedStart]);
      expect(paid2.status).toBe("fulfilled");
      expect(start2.status).toBe("rejected");
      expect((start2 as PromiseRejectedResult).reason).toBeInstanceOf(BudgetExceededError);
      expect(((start2 as PromiseRejectedResult).reason as BudgetExceededError).reason).toContain("extra budget");
    });
  });

  describe("task duration timer", () => {
    it("aborts an active task when maxTaskDurationMs is reached", async () => {
      vi.useFakeTimers();
      const clock = clockAt("2026-11-02T10:00:00.000Z");
      const manager = managerFor(await temporaryDirectory(), { now: clock.now, policy: { maxTaskDurationMs: 1000 } });
      const handle = await manager.startTask({ taskId: "slow", agentId: "developer" });
      vi.advanceTimersByTime(999);
      expect(handle.abortController.signal.aborted).toBe(false);
      vi.advanceTimersByTime(1);
      expect(handle.abortController.signal.aborted).toBe(true);
      expect(handle.abortController.signal.reason).toBeInstanceOf(BudgetExceededError);
      expect(handle.abortController.signal.reason.reason).toBe("maximum task duration exceeded");
      handle.release();
    });

    it("clears the timer on release so a finished task is never aborted", async () => {
      vi.useFakeTimers();
      const manager = managerFor(await temporaryDirectory(), { policy: { maxTaskDurationMs: 1000 } });
      const handle = await manager.startTask({ taskId: "quick", agentId: "developer" });
      expect(vi.getTimerCount()).toBe(1);
      handle.release();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(5000);
      expect(handle.abortController.signal.aborted).toBe(false);
      handle.release();
      expect((await manager.getSnapshot()).activeTaskCount).toBe(0);
    });

    it("does not abort a task that finished before the limit and frees its slot", async () => {
      vi.useFakeTimers();
      const manager = managerFor(await temporaryDirectory(), { policy: { maxTaskDurationMs: 1000, maxConcurrentTasks: 1 } });
      const first = await manager.startTask({ taskId: "first", agentId: "developer" });
      vi.advanceTimersByTime(500);
      first.release();
      const second = await manager.startTask({ taskId: "second", agentId: "developer" });
      vi.advanceTimersByTime(999);
      expect(second.abortController.signal.aborted).toBe(false);
      vi.advanceTimersByTime(1);
      expect(first.abortController.signal.aborted).toBe(false);
      expect(second.abortController.signal.aborted).toBe(true);
      second.release();
    });

    it("does not leak timers when many tasks start and release", async () => {
      vi.useFakeTimers();
      const manager = managerFor(await temporaryDirectory(), { policy: { maxTaskDurationMs: 1000 } });
      for (let index = 0; index < 20; index += 1) {
        const handle = await manager.startTask({ taskId: `loop-${index}`, agentId: "developer" });
        handle.release();
      }
      expect(vi.getTimerCount()).toBe(0);
    });

    it("handles a usage event and the timer expiry in either order without double-counting or throwing on the timer path", async () => {
      vi.useFakeTimers();
      const clock = clockAt("2026-11-02T10:00:00.000Z");
      const manager = managerFor(await temporaryDirectory(), { now: clock.now, policy: { maxTaskDurationMs: 1000 } });
      const handle = await manager.startTask({ taskId: "race", agentId: "developer" });

      // Usage arrives before the limit: accepted and not a violation.
      clock.set("2026-11-02T10:00:00.500Z");
      await expect(manager.recordUsage(baseEvent({ taskId: "race", eventId: "in-time", timestamp: "2026-11-02T10:00:00.500Z" }))).resolves.toBeDefined();
      expect(handle.abortController.signal.aborted).toBe(false);

      // Timer fires at the limit: abort without a thrown error.
      clock.set("2026-11-02T10:00:01.000Z");
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
      expect(handle.abortController.signal.aborted).toBe(true);

      // Usage arriving after the limit is still recorded, and reports the violation.
      await expect(manager.recordUsage(baseEvent({ taskId: "race", eventId: "late", timestamp: "2026-11-02T10:00:01.000Z" }))).rejects.toBeInstanceOf(BudgetExceededError);
      expect((await manager.getUsageSummary({ taskId: "race" })).eventCount).toBe(2);
      handle.release();
    });

    it("uses the injected clock for duration checks on usage events", async () => {
      const clock = clockAt("2026-11-02T10:00:00.000Z");
      const manager = managerFor(await temporaryDirectory(), { now: clock.now, policy: { maxTaskDurationMs: 60_000 } });
      const handle = await manager.startTask({ taskId: "clocked", agentId: "developer" });
      clock.set("2026-11-02T10:01:00.000Z");
      await expect(manager.recordUsage(baseEvent({ taskId: "clocked", eventId: "late-clock", timestamp: "2026-11-02T10:01:00.000Z" }))).rejects.toThrow(/duration/);
      handle.release();
    });

    it("rejects a duration limit that cannot be scheduled as a timer", () => {
      expect(() => new BudgetManager(new JsonlUsageStore("/tmp/oao-budget-timer.jsonl"), { policy: { maxTaskDurationMs: 2 ** 31 } })).toThrow(BudgetPolicyError);
    });
  });

  describe("input validation", () => {
    it("rejects invalid task requests before any budget check", async () => {
      const manager = managerFor(await temporaryDirectory());
      await expect(manager.startTask({ taskId: "bad id", agentId: "developer" })).rejects.toThrow(TypeError);
      await expect(manager.startTask({ taskId: "task-1", agentId: "" })).rejects.toThrow(TypeError);
      await expect(manager.startTask({ taskId: "task-1", agentId: "developer", startedAt: "not-a-date" })).rejects.toThrow(TypeError);
      expect((await manager.getSnapshot()).activeTaskCount).toBe(0);
    });

    it("rejects NaN, Infinity and negative estimates so they cannot bypass limits", async () => {
      const manager = managerFor(await temporaryDirectory(), { policy: { maxReportedCostUsdPerTask: 1, maxTotalTokensPerTask: 100 } });
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
        await expect(manager.checkTaskStart({ taskId: "t", agentId: "developer", estimatedCostUsd: bad })).rejects.toThrow(TypeError);
        await expect(manager.checkTaskStart({ taskId: "t", agentId: "developer", estimatedTotalTokens: bad })).rejects.toThrow(TypeError);
        await expect(manager.startTask({ taskId: "t", agentId: "developer", estimatedDurationMs: bad })).rejects.toThrow(TypeError);
      }
    });

    it("rejects invalid cash payments", async () => {
      const manager = managerFor(await temporaryDirectory());
      await expect(manager.recordCashPayment(payment({ amountRub: Number.NaN }))).rejects.toThrow(TypeError);
      await expect(manager.recordCashPayment(payment({ amountRub: Number.POSITIVE_INFINITY }))).rejects.toThrow(TypeError);
      await expect(manager.recordCashPayment(payment({ amountRub: -1 }))).rejects.toThrow(TypeError);
      await expect(manager.recordCashPayment(payment({ timestamp: "not-a-date" }))).rejects.toThrow(TypeError);
      await expect(manager.recordCashPayment(payment({ paymentId: "" }))).rejects.toThrow(TypeError);
      expect(await manager.getCashPayments()).toEqual([]);
    });

    it("rejects non-finite usage metrics", async () => {
      const manager = new BudgetManager(new JsonlUsageStore((await temporaryDirectory()).usagePath));
      await expect(manager.recordUsage(baseEvent({ costUsd: Number.NaN }))).rejects.toThrow(TypeError);
      await expect(manager.recordUsage(baseEvent({ total: Number.POSITIVE_INFINITY }))).rejects.toThrow(TypeError);
      await expect(manager.recordUsage(baseEvent({ timestamp: "garbage" }))).rejects.toThrow(TypeError);
    });
  });
});
