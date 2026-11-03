import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BudgetExceededError,
  BudgetManager,
  BudgetStoreError,
  CashPaymentConflictError,
  JsonlCashPaymentStore,
  JsonlUsageStore,
  UsageEventConflictError,
  type BudgetPolicyConfig,
  type CashPayment,
  type UsageRecord,
} from "../src/index";

const NOW = "2026-11-02T10:00:00.000Z";

const baseEvent = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  eventId: "event-1",
  agentId: "developer",
  modelId: "opencode-go/claude-haiku-5-5",
  taskId: "task-1",
  projectId: "project-1",
  sessionId: "session-1",
  timestamp: NOW,
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
  timestamp: NOW,
  ...overrides,
});

const directories: string[] = [];

async function paths(): Promise<{ directory: string; usagePath: string; paymentPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "oao-budget-hard-"));
  directories.push(directory);
  return { directory, usagePath: join(directory, "usage.jsonl"), paymentPath: join(directory, "payments.jsonl") };
}

function managerFor(p: { usagePath: string; paymentPath: string }, options: { now?: () => string; policy?: Partial<BudgetPolicyConfig> } = {}): BudgetManager {
  return new BudgetManager(new JsonlUsageStore(p.usagePath), { ...options, paymentStore: new JsonlCashPaymentStore(p.paymentPath) });
}

function clockAt(initial: string): { now: () => string; set: (value: string) => void } {
  let current = initial;
  return { now: () => current, set: (value) => { current = value; } };
}

/** Lines that parse as JSON; torn or damaged lines are excluded. */
function parsableLines(raw: string): unknown[] {
  return raw.split("\n").filter((line) => line.trim()).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true });
});

describe("usage journal hardening", () => {
  it("appends after a torn usage line and does not glue the new record onto it", async () => {
    const p = await paths();
    await writeFile(p.usagePath, '{"eventId":"torn","agentId":"developer","modelId":"m","taskId":"task-1","timestamp":"2026-11-0', "utf8");
    const store = new JsonlUsageStore(p.usagePath);
    expect(await store.appendUsage(baseEvent({ eventId: "after-torn" }))).toBe(true);
    const restored = await new JsonlUsageStore(p.usagePath).readUsage();
    expect(restored.map((record) => record.eventId)).toEqual(["after-torn"]);
  });

  it("keeps every complete record on its own line", async () => {
    const p = await paths();
    const store = new JsonlUsageStore(p.usagePath);
    await store.appendUsage(baseEvent({ eventId: "one" }));
    await writeFile(p.usagePath, `${await readFile(p.usagePath, "utf8")}{"eventId":"torn"`, "utf8");
    await store.appendUsage(baseEvent({ eventId: "two" }));
    const raw = await readFile(p.usagePath, "utf8");
    const ids = parsableLines(raw).map((record) => (record as UsageRecord).eventId);
    expect(ids).toEqual(["one", "two"]);
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("calls handle.sync() (fsync) on every append", async () => {
    const p = await paths();
    const probe = await open(join(p.directory, "probe"), "w");
    const proto = Object.getPrototypeOf(probe) as { sync: () => Promise<void> };
    await probe.close();
    const sync = vi.spyOn(proto, "sync");
    const store = new JsonlUsageStore(p.usagePath);
    await store.appendUsage(baseEvent({ eventId: "durable" }));
    expect(sync).toHaveBeenCalled();
    const callsAfterFirst = sync.mock.calls.length;
    await store.appendUsage(baseEvent({ eventId: "durable-2" }));
    expect(sync.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("creates the journal with mode 0600 and its directory with mode 0700", async () => {
    const p = await paths();
    const nested = join(p.directory, "nested", "usage");
    await new JsonlUsageStore(join(nested, "usage.jsonl")).appendUsage(baseEvent({ eventId: "perm" }));
    expect((await stat(join(nested, "usage.jsonl"))).mode & 0o777).toBe(0o600);
    expect((await stat(nested)).mode & 0o777).toBe(0o700);
  });

  it("tightens an existing journal file to mode 0600 on append", async () => {
    const p = await paths();
    await writeFile(p.usagePath, "", "utf8");
    await chmod(p.usagePath, 0o644);
    await new JsonlUsageStore(p.usagePath).appendUsage(baseEvent({ eventId: "tighten" }));
    expect((await stat(p.usagePath)).mode & 0o777).toBe(0o600);
  });

  it("skips damaged, invalid and non-whitelisted records on read", async () => {
    const p = await paths();
    const lines = [
      "{not json",
      JSON.stringify({ ...baseEvent({ eventId: "bad-cost" }), costUsd: "NaN" }),
      JSON.stringify({ ...baseEvent({ eventId: "bad-time" }), timestamp: "yesterday" }),
      JSON.stringify({ ...baseEvent({ eventId: "bad-id" }), agentId: "dev eloper" }),
      JSON.stringify({ ...baseEvent({ eventId: "bad-event id" }) }),
      JSON.stringify({ ...baseEvent({ eventId: "negative" }), input: -5 }),
      JSON.stringify({ ...baseEvent({ eventId: "extra-field" }), prompt: "private prompt" }),
      JSON.stringify({ ...baseEvent({ eventId: "bad-project" }), projectId: "bad project!" }),
      JSON.stringify(baseEvent({ eventId: "good" })),
    ];
    await writeFile(p.usagePath, `${lines.join("\n")}\n`, "utf8");
    const records = await new JsonlUsageStore(p.usagePath).readUsage();
    expect(records.map((record) => record.eventId)).toEqual(["good"]);
  });

  it("does not persist fields outside UsageRecord", async () => {
    const p = await paths();
    await new JsonlUsageStore(p.usagePath).appendUsage({ ...baseEvent({ eventId: "clean" }), prompt: "private prompt", apiKey: "api-secret" } as UsageRecord);
    const raw = await readFile(p.usagePath, "utf8");
    expect(raw).not.toContain("private prompt");
    expect(raw).not.toContain("api-secret");
  });

  it("returns false for an identical repeat and throws UsageEventConflictError for different data", async () => {
    const p = await paths();
    const store = new JsonlUsageStore(p.usagePath);
    expect(await store.appendUsage(baseEvent({ eventId: "dup" }))).toBe(true);
    expect(await store.appendUsage(baseEvent({ eventId: "dup" }))).toBe(false);
    const before = await readFile(p.usagePath, "utf8");
    await expect(store.appendUsage(baseEvent({ eventId: "dup", costUsd: 99 }))).rejects.toBeInstanceOf(UsageEventConflictError);
    expect(await readFile(p.usagePath, "utf8")).toBe(before);
  });

  it("refuses to load a journal with two conflicting lines for one eventId", async () => {
    const p = await paths();
    await writeFile(p.usagePath, `${JSON.stringify(baseEvent({ eventId: "same" }))}\n${JSON.stringify(baseEvent({ eventId: "same", costUsd: 7 }))}\n`, "utf8");
    await expect(new JsonlUsageStore(p.usagePath).readUsage()).rejects.toBeInstanceOf(UsageEventConflictError);
  });

  it("surfaces an explicit-eventId conflict through BudgetManager without changing the ledger", async () => {
    const p = await paths();
    const manager = managerFor(p, { now: () => NOW });
    await manager.recordUsage(baseEvent({ eventId: "manager-dup", costUsd: 1 }));
    await expect(manager.recordUsage(baseEvent({ eventId: "manager-dup", costUsd: 5 }))).rejects.toBeInstanceOf(UsageEventConflictError);
    expect((await manager.getUsageSummary()).costUsd).toBe(1);
    expect((await manager.getUsageSummary()).eventCount).toBe(1);
  });

  it("requires an absolute usage journal path", () => {
    expect(() => new JsonlUsageStore("usage.jsonl")).toThrow(TypeError);
  });
});

describe("identifier and timestamp validation", () => {
  it("rejects invalid projectId and sessionId in usage events", async () => {
    const manager = managerFor(await paths(), { now: () => NOW });
    await expect(manager.recordUsage(baseEvent({ eventId: "p1", projectId: "bad project!" }))).rejects.toThrow(TypeError);
    await expect(manager.recordUsage(baseEvent({ eventId: "s1", sessionId: "" }))).rejects.toThrow(TypeError);
    await expect(manager.recordUsage(baseEvent({ eventId: "e1 spaces" }))).rejects.toThrow(TypeError);
    expect((await manager.getUsageSummary()).eventCount).toBe(0);
  });

  it("rejects invalid projectId and sessionId in task requests", async () => {
    const manager = managerFor(await paths(), { now: () => NOW });
    await expect(manager.startTask({ taskId: "t1", agentId: "developer", projectId: "bad/project" })).rejects.toThrow(TypeError);
    await expect(manager.checkTaskStart({ taskId: "t1", agentId: "developer", sessionId: "  " })).rejects.toThrow(TypeError);
  });

  it("rejects timestamps that are not ISO 8601 date-times", async () => {
    const manager = managerFor(await paths(), { now: () => NOW });
    await expect(manager.recordUsage(baseEvent({ eventId: "t1", timestamp: "Nov 2 2026" }))).rejects.toThrow(TypeError);
    await expect(manager.recordUsage(baseEvent({ eventId: "t2", timestamp: "2026-11-02" }))).rejects.toThrow(TypeError);
    await expect(manager.recordCashPayment(payment({ timestamp: "2026-11-02T10:00:00" }))).rejects.toThrow(TypeError);
  });
});

describe("single operation queue", () => {
  it("serializes a usage event and a task start in call order (usage first blocks the start)", async () => {
    const p = await paths();
    const manager = managerFor(p, { now: () => NOW, policy: { agentLimits: { developer: { maxReportedCostUsd: 2 } } } });
    const [usage, start] = await Promise.allSettled([
      manager.recordUsage(baseEvent({ eventId: "usage-first", costUsd: 2 })),
      manager.startTask({ taskId: "task-after-usage", agentId: "developer", estimatedCostUsd: 0.5 }),
    ]);
    expect(usage.status).toBe("fulfilled");
    expect(start.status).toBe("rejected");
  });

  it("serializes a task start and a usage event in call order (start first is admitted)", async () => {
    const p = await paths();
    const manager = managerFor(p, { now: () => NOW, policy: { agentLimits: { developer: { maxReportedCostUsd: 2 } } } });
    const [start, usage] = await Promise.allSettled([
      manager.startTask({ taskId: "task-before-usage", agentId: "developer", estimatedCostUsd: 0.5 }),
      manager.recordUsage(baseEvent({ eventId: "usage-second", costUsd: 2 })),
    ]);
    expect(start.status).toBe("fulfilled");
    expect(usage.status).toBe("fulfilled");
    if (start.status === "fulfilled") start.value.release();
  });

  it("does not let concurrent usage events lose or double-count records", async () => {
    const manager = managerFor(await paths(), { now: () => NOW });
    const unique = Array.from({ length: 20 }, (_, index) => baseEvent({ eventId: `burst-${index}`, costUsd: 0.1 }));
    const duplicates = Array.from({ length: 5 }, () => baseEvent({ eventId: "burst-0", costUsd: 0.1 }));
    await Promise.all([...unique, ...duplicates].map((event) => manager.recordUsage(event)));
    const summary = await manager.getUsageSummary();
    expect(summary.eventCount).toBe(20);
    expect(summary.costUsd).toBeCloseTo(2, 10);
  });

  it("enforces a task limit against concurrent usage events in queue order", async () => {
    const manager = managerFor(await paths(), { now: () => NOW, policy: { maxReportedCostUsdPerTask: 1 } });
    const handle = await manager.startTask({ taskId: "task-1", agentId: "developer" });
    const results = await Promise.allSettled([0.5, 0.5, 0.5].map((cost, index) => manager.recordUsage(baseEvent({ eventId: `limit-${index}`, costUsd: cost }))));
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(handle.abortController.signal.aborted).toBe(true);
    handle.release();
  });

  it("serializes a usage event and a cash payment that aborts the same task", async () => {
    const p = await paths();
    const manager = managerFor(p, { now: () => NOW, policy: { subscriptionCostRub: 0 } });
    const handle = await manager.startTask({ taskId: "task-1", agentId: "developer" });
    const [paid, usage] = await Promise.allSettled([
      manager.recordCashPayment(payment({ paymentId: "race-pay", amountRub: 1000 })),
      manager.recordUsage(baseEvent({ eventId: "race-usage", taskId: "task-1" })),
    ]);
    expect(paid.status).toBe("fulfilled");
    expect(usage.status).toBe("fulfilled");
    expect(handle.abortController.signal.aborted).toBe(true);
    expect((await manager.getUsageSummary()).eventCount).toBe(1);
    handle.release();
  });

  it("does not deadlock when a payment, a usage event and a start are queued together", async () => {
    const manager = managerFor(await paths(), { now: () => NOW, policy: { subscriptionCostRub: 0 } });
    const results = await Promise.race([
      Promise.allSettled([
        manager.recordUsage(baseEvent({ eventId: "dl-1" })),
        manager.recordCashPayment(payment({ paymentId: "dl-pay", amountRub: 10 })),
        manager.startTask({ taskId: "dl-task", agentId: "developer" }),
        manager.recordUsage(baseEvent({ eventId: "dl-2" })),
      ]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("deadlock")), 2000).unref()),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    if (results[2].status === "fulfilled") results[2].value.release();
  });
});

describe("cash payment abort of active tasks", () => {
  it("aborts every active task when a current-month payment exhausts the extra budget", async () => {
    const manager = managerFor(await paths(), { now: () => NOW, policy: { subscriptionCostRub: 0, maxConcurrentTasks: 3 } });
    const a = await manager.startTask({ taskId: "a", agentId: "developer" });
    const b = await manager.startTask({ taskId: "b", agentId: "analyst" });
    await manager.recordCashPayment(payment({ paymentId: "block", amountRub: 1000 }));
    for (const handle of [a, b]) {
      expect(handle.abortController.signal.aborted).toBe(true);
      expect(handle.abortController.signal.reason).toBeInstanceOf(BudgetExceededError);
      expect((handle.abortController.signal.reason as BudgetExceededError).reason).toContain("extra budget exhausted");
    }
    // Tasks stay registered until the owner releases them.
    expect((await manager.getSnapshot()).activeTaskCount).toBe(2);
    a.release();
    b.release();
    expect((await manager.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("does not abort tasks when the payment keeps the budget below blocked", async () => {
    const manager = managerFor(await paths(), { now: () => NOW, policy: { subscriptionCostRub: 0 } });
    const handle = await manager.startTask({ taskId: "warn-task", agentId: "developer" });
    await manager.recordCashPayment(payment({ paymentId: "warn", amountRub: 800 }));
    expect(handle.abortController.signal.aborted).toBe(false);
    expect((await manager.getSnapshot()).status).toBe("warning");
    handle.release();
  });

  it("does not abort current tasks for a payment that belongs to the previous month", async () => {
    const clock = clockAt("2026-11-10T10:00:00.000Z");
    const manager = managerFor(await paths(), { now: clock.now, policy: { subscriptionCostRub: 0 } });
    const handle = await manager.startTask({ taskId: "nov-task", agentId: "developer" });
    await manager.recordCashPayment(payment({ paymentId: "oct-block", amountRub: 1000, timestamp: "2026-10-20T10:00:00.000Z" }));
    expect(handle.abortController.signal.aborted).toBe(false);
    expect((await manager.getSnapshot()).status).toBe("normal");
    handle.release();
  });

  it("does not repeat abort side effects for an identical duplicate payment", async () => {
    const manager = managerFor(await paths(), { now: () => NOW, policy: { subscriptionCostRub: 0 } });
    const handle = await manager.startTask({ taskId: "once", agentId: "developer" });
    const listener = vi.fn();
    handle.abortController.signal.addEventListener("abort", listener);
    await manager.recordCashPayment(payment({ paymentId: "dup-block", amountRub: 1000 }));
    await manager.recordCashPayment(payment({ paymentId: "dup-block", amountRub: 1000 }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect((await manager.getCashPayments()).filter((item) => item.paymentId === "dup-block")).toHaveLength(1);
    expect((await manager.getSnapshot()).extraSpendRub).toBe(1000);
    handle.release();
  });

  it("does not abort tasks on a conflicting payment that is rejected", async () => {
    const manager = managerFor(await paths(), { now: () => NOW, policy: { subscriptionCostRub: 0 } });
    await manager.recordCashPayment(payment({ paymentId: "conflict-block", amountRub: 100 }));
    const handle = await manager.startTask({ taskId: "still-running", agentId: "developer" });
    await expect(manager.recordCashPayment(payment({ paymentId: "conflict-block", amountRub: 1000 }))).rejects.toBeInstanceOf(CashPaymentConflictError);
    expect(handle.abortController.signal.aborted).toBe(false);
    handle.release();
  });

  it("requires a configured payment store for payment-driven abort", async () => {
    const p = await paths();
    const manager = new BudgetManager(new JsonlUsageStore(p.usagePath), { now: () => NOW });
    await expect(manager.recordCashPayment(payment())).rejects.toBeInstanceOf(BudgetStoreError);
  });
});

describe("task duration with startedAt", () => {
  it("arms the timer for the remaining time counted from startedAt", async () => {
    vi.useFakeTimers();
    const clock = clockAt("2026-11-02T10:00:00.600Z");
    const manager = managerFor(await paths(), { now: clock.now, policy: { maxTaskDurationMs: 1000 } });
    const handle = await manager.startTask({ taskId: "started-earlier", agentId: "developer", startedAt: "2026-11-02T10:00:00.000Z" });
    vi.advanceTimersByTime(399);
    expect(handle.abortController.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(handle.abortController.signal.aborted).toBe(true);
    handle.release();
  });

  it("rejects a task whose limit is already reached at start, without arming a timer", async () => {
    vi.useFakeTimers();
    const clock = clockAt("2026-11-02T10:00:01.000Z");
    const manager = managerFor(await paths(), { now: clock.now, policy: { maxTaskDurationMs: 1000 } });
    await expect(manager.startTask({ taskId: "expired", agentId: "developer", startedAt: "2026-11-02T10:00:00.000Z" })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(vi.getTimerCount()).toBe(0);
    expect((await manager.getSnapshot()).activeTaskCount).toBe(0);
    const preview = await manager.checkTaskStart({ taskId: "expired-preview", agentId: "developer", startedAt: "2026-11-02T10:00:00.000Z" });
    expect(preview.allowed).toBe(false);
    expect(preview.reason).toContain("already reached");
  });

  it("rejects a startedAt in the future so the limit cannot be stretched", async () => {
    const manager = managerFor(await paths(), { now: () => NOW, policy: { maxTaskDurationMs: 1000 } });
    await expect(manager.startTask({ taskId: "future", agentId: "developer", startedAt: "2026-11-02T10:05:00.000Z" })).rejects.toThrow(/future/);
  });

  it("does not grant extra time for registration delay", async () => {
    vi.useFakeTimers();
    const clock = clockAt("2026-11-02T10:00:00.000Z");
    const manager = managerFor(await paths(), { now: clock.now, policy: { maxTaskDurationMs: 1000 } });
    clock.set("2026-11-02T10:00:00.900Z");
    const handle = await manager.startTask({ taskId: "delayed", agentId: "developer", startedAt: "2026-11-02T10:00:00.000Z" });
    vi.advanceTimersByTime(99);
    expect(handle.abortController.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(handle.abortController.signal.aborted).toBe(true);
    handle.release();
  });

  it("clears the timer on release even when startedAt was in the past", async () => {
    vi.useFakeTimers();
    const clock = clockAt("2026-11-02T10:00:00.500Z");
    const manager = managerFor(await paths(), { now: clock.now, policy: { maxTaskDurationMs: 1000 } });
    const handle = await manager.startTask({ taskId: "cleared", agentId: "developer", startedAt: "2026-11-02T10:00:00.000Z" });
    expect(vi.getTimerCount()).toBe(1);
    handle.release();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(handle.abortController.signal.aborted).toBe(false);
  });

  it("does not let an old timer abort a new task that reuses the same taskId", async () => {
    vi.useFakeTimers();
    const clock = clockAt("2026-11-02T10:00:00.000Z");
    const manager = managerFor(await paths(), { now: clock.now, policy: { maxTaskDurationMs: 1000 } });
    const first = await manager.startTask({ taskId: "reused", agentId: "developer" });
    vi.advanceTimersByTime(100);
    first.release();
    clock.set("2026-11-02T10:00:00.100Z");
    // Second task starts at t=100ms, so its own deadline is t=1100ms.
    const second = await manager.startTask({ taskId: "reused", agentId: "developer" });
    // t=1000ms: the stale deadline of the first task has passed, but it was cleared on release.
    vi.advanceTimersByTime(900);
    expect(first.abortController.signal.aborted).toBe(false);
    expect(second.abortController.signal.aborted).toBe(false);
    vi.advanceTimersByTime(100);
    expect(second.abortController.signal.aborted).toBe(true);
    expect(first.abortController.signal.aborted).toBe(false);
    second.release();
  });

  it("uses the injected clock for usage events on a task started with an earlier startedAt", async () => {
    const clock = clockAt("2026-11-02T10:00:00.000Z");
    const manager = managerFor(await paths(), { now: clock.now, policy: { maxTaskDurationMs: 60_000 } });
    const handle = await manager.startTask({ taskId: "old-start", agentId: "developer", startedAt: "2026-11-02T09:59:30.000Z" });
    clock.set("2026-11-02T10:00:30.000Z");
    await expect(manager.recordUsage(baseEvent({ taskId: "old-start", eventId: "late", timestamp: "2026-11-02T10:00:30.000Z" }))).rejects.toThrow(/duration/);
    handle.release();
  });
});
