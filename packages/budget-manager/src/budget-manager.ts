import { currentAccountingPeriod, monthAccountingPeriod, type AccountingPeriod } from "./accounting-period.js";
import { AsyncMutex } from "./async-mutex.js";
import { mergeBudgetPolicy } from "./budget-policy.js";
import { BudgetExceededError, BudgetStoreError, CashPaymentConflictError } from "./errors.js";
import { usageEventId } from "./jsonl-store.js";
import { UsageLedger } from "./usage-ledger.js";
import { BudgetGuard, normalizeGuardRequest, subscriptionBlockReason, subscriptionPeriodFor, subscriptionUsageFromSummary, type BudgetGuardTaskRequest } from "./budget-guard.js";
import type { BudgetDecision, BudgetPolicyConfig, BudgetSnapshot, CashPayment, CashPaymentStore, TaskBudgetRequest, TaskHandle, UsageEventInput, UsageRecord, UsageStore, UsageSummary } from "./types.js";
import { normalizeCashPayment, normalizeUsageInput, samePayment } from "./validation.js";

export interface BudgetManagerOptions {
  policy?: Partial<BudgetPolicyConfig>;
  /** Logical clock returning an ISO timestamp. Used for periods, usage timestamps and task duration. */
  now?: () => string;
  /**
   * Durable store for cash payments. Without it, payment operations and budget
   * snapshots fail explicitly instead of keeping payments only in memory.
   */
  paymentStore?: CashPaymentStore;
}

interface ActiveTask {
  request: TaskBudgetRequest;
  handle: TaskHandle;
  timer?: ReturnType<typeof setTimeout>;
}

const isoNow = (): string => new Date().toISOString();

/**
 * Coordinates usage accounting, cash payments and task admission.
 *
 * Concurrency: `startTask()`, `recordCashPayment()` and `recordUsage()` run in one
 * in-process FIFO queue (AsyncMutex). A limit check, a task registration and a
 * usage/payment write therefore never interleave with each other inside this
 * Node.js process. This is not an inter-process guarantee. The queue is not
 * re-entered from inside its own operations, so there is no nested-lock deadlock.
 * `checkTaskStart()` is only a preview and does not reserve a slot.
 */
export class BudgetManager {
  readonly policy: BudgetPolicyConfig;
  readonly guard: BudgetGuard;
  private readonly ledger = new UsageLedger();
  private readonly activeTasks = new Map<string, ActiveTask>();
  private readonly payments = new Map<string, CashPayment>();
  private readonly admission = new AsyncMutex();
  private readonly clock: () => string;
  private usageLoaded?: Promise<void>;
  private paymentsLoaded?: Promise<void>;

  constructor(private readonly store: UsageStore, private readonly options: BudgetManagerOptions = {}) {
    this.policy = mergeBudgetPolicy(options.policy);
    this.clock = options.now ?? isoNow;
    this.guard = new BudgetGuard(this);
  }

  classify(request: BudgetGuardTaskRequest) { return this.guard.classify(request); }
  async precheck(request: BudgetGuardTaskRequest) { return this.guard.precheck(request); }
  async view() { return this.guard.view(); }
  computeSlotPolicy(input: Parameters<BudgetGuard["computeSlots"]>[0]) { return this.guard.computeSlots(input); }

  /**
   * Loads the usage journal and, when configured, the payment journal.
   * Loading also happens lazily on the first call that needs the data.
   */
  async load(): Promise<void> {
    await this.ensureUsageLoaded();
    if (this.options.paymentStore) await this.ensurePaymentsLoaded();
  }

  /**
   * Records a usage event. An identical repeat is a no-op (no limit re-check).
   * A new event on an active task is checked against task limits.
   */
  async recordUsage(input: UsageEventInput): Promise<UsageRecord> {
    const usage = normalizeUsageInput(input);
    return this.admission.run(async () => {
      await this.ensureUsageLoaded();
      const timestamp = usage.timestamp ?? this.currentTime();
      const record: UsageRecord = {
        ...usage,
        timestamp,
        eventId: usageEventId({ ...usage, timestamp, eventId: usage.eventId }),
      };
      let accepted: boolean;
      try {
        accepted = await this.store.appendUsage(record);
      } catch (cause) {
        if (cause instanceof BudgetStoreError) throw cause;
        throw new BudgetStoreError("Unable to append usage event", cause);
      }
      if (!accepted) return record;
      this.ledger.add(record);
      const active = this.activeTasks.get(record.taskId);
      if (active) this.enforceTaskLimits(active);
      return record;
    });
  }

  async getUsageSummary(filter: Parameters<UsageLedger["summarize"]>[0] = {}): Promise<UsageSummary> {
    await this.ensureUsageLoaded();
    return this.ledger.summarize(filter);
  }

  /** Usage for one calendar month (YYYY-MM in the accounting zone); defaults to the current month. */
  async getMonthlySummary(month?: string): Promise<UsageSummary> {
    await this.ensureUsageLoaded();
    const period = month === undefined ? this.currentPeriod() : monthAccountingPeriod(month, this.policy.accountingTimeZone);
    return this.ledger.summarize({ from: period.from, to: period.to });
  }

  /**
   * Records a manual RUB payment. Identical repeats are no-ops with no side effects.
   * If the payment belongs to the current month and the budget becomes `blocked`,
   * every active task is aborted with BudgetExceededError. Tasks stay registered
   * until their owner calls `release()`.
   */
  async recordCashPayment(input: CashPayment): Promise<CashPayment> {
    const payment = normalizeCashPayment(input);
    const store = this.requirePaymentStore();
    return this.admission.run(async () => {
      await this.ensureUsageLoaded();
      await this.ensurePaymentsLoaded();
      const existing = this.payments.get(payment.paymentId);
      if (existing) {
        if (samePayment(existing, payment)) return { ...existing };
        throw new CashPaymentConflictError(payment.paymentId);
      }
      try {
        await store.appendPayment(payment);
      } catch (cause) {
        if (cause instanceof BudgetStoreError) throw cause;
        throw new BudgetStoreError("Unable to append cash payment", cause);
      }
      this.payments.set(payment.paymentId, payment);
      this.abortActiveTasksIfBlocked(payment);
      return { ...payment };
    });
  }

  /** All payments in the journal, including previous months. */
  async getCashPayments(): Promise<CashPayment[]> {
    await this.ensurePaymentsLoaded();
    return [...this.payments.values()].map((payment) => ({ ...payment }));
  }

  async getSnapshot(): Promise<BudgetSnapshot> {
    await this.ensureUsageLoaded();
    await this.ensurePaymentsLoaded();
    return this.buildSnapshot(this.currentTime());
  }

  /** Preview only: reports whether `startTask()` would currently succeed. Does not register the task. */
  async checkTaskStart(request: BudgetGuardTaskRequest): Promise<BudgetDecision> {
    // Guard fields are validated like the rest: NaN estimates must not
    // bypass subscription limits, an arbitrary category must not mask a provider.
    const normalized = normalizeGuardRequest(request);
    await this.ensureUsageLoaded();
    await this.ensurePaymentsLoaded();
    const now = this.currentTime();
    const snapshot = this.buildSnapshot(now);
    const reason = this.startBlockReason(normalized, snapshot, now);
    return { allowed: !reason, reason: reason ?? "Task is within configured budget policy", snapshot };
  }

  /**
   * Atomically checks limits, active tasks and budget, then registers the task.
   * This is the only operation that reserves a concurrency slot.
   */
  async startTask(request: BudgetGuardTaskRequest): Promise<TaskHandle> {
    const normalized = normalizeGuardRequest(request);
    return this.admission.run(async () => {
      await this.ensureUsageLoaded();
      await this.ensurePaymentsLoaded();
      const now = this.currentTime();
      const snapshot = this.buildSnapshot(now);
      const reason = this.startBlockReason(normalized, snapshot, now);
      if (reason) throw new BudgetExceededError(reason);
      return this.register(normalized, normalized.startedAt ?? now, now);
    });
  }

  /** Releases the task slot and clears its duration timer. Idempotent. */
  releaseTask(taskId: string): void {
    const active = this.activeTasks.get(taskId);
    if (active) this.releaseEntry(active);
  }

  /**
   * Registers a task. The timer is armed for the time that is left of
   * maxTaskDurationMs counted from startedAt, so registration delay is charged
   * to the task instead of extending it.
   */
  private register(request: TaskBudgetRequest, startedAt: string, now: string): TaskHandle {
    const handle: TaskHandle = {
      taskId: request.taskId,
      agentId: request.agentId,
      abortController: new AbortController(),
      startedAt,
      release: () => this.releaseEntry(entry),
    };
    const entry: ActiveTask = { request, handle };
    if (this.policy.maxTaskDurationMs !== null) {
      const remaining = this.remainingDurationMs(startedAt, now);
      if (remaining <= 0) throw new BudgetExceededError("maximum task duration already reached");
      entry.timer = setTimeout(() => this.expireTask(entry), remaining);
      entry.timer.unref?.();
    }
    this.activeTasks.set(request.taskId, entry);
    return handle;
  }

  private releaseEntry(entry: ActiveTask): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
    if (this.activeTasks.get(entry.request.taskId) === entry) this.activeTasks.delete(entry.request.taskId);
  }

  private expireTask(entry: ActiveTask): void {
    entry.timer = undefined;
    // A task released or replaced before the timer fired must not be aborted.
    if (this.activeTasks.get(entry.request.taskId) !== entry) return;
    entry.handle.abortController.abort(new BudgetExceededError("maximum task duration exceeded"));
  }

  private remainingDurationMs(startedAt: string, now: string): number {
    const limit = this.policy.maxTaskDurationMs ?? Number.POSITIVE_INFINITY;
    return limit - (Date.parse(now) - Date.parse(startedAt));
  }

  /** Aborts all active tasks that are not already aborted, but only when a current-month payment blocks the budget. */
  private abortActiveTasksIfBlocked(payment: CashPayment): void {
    const now = this.currentTime();
    const period = this.currentPeriod(now);
    if (!this.inPeriod(payment.timestamp, period)) return;
    if (this.buildSnapshot(now).status !== "blocked") return;
    const reason = new BudgetExceededError("extra RUB spend recorded for the current month: extra budget exhausted");
    for (const active of this.activeTasks.values()) {
      if (!active.handle.abortController.signal.aborted) active.handle.abortController.abort(reason);
    }
  }

  private enforceTaskLimits(active: ActiveTask): void {
    const now = this.currentTime();
    const summary = this.ledger.summarize({ taskId: active.request.taskId });
    const limit = this.policy;
    const violations: string[] = [];
    if (limit.maxReportedCostUsdPerTask !== null && summary.costUsd > limit.maxReportedCostUsdPerTask) violations.push("maximum reported USD cost per task exceeded");
    if (limit.maxTotalTokensPerTask !== null && summary.total > limit.maxTotalTokensPerTask) violations.push("maximum total tokens per task exceeded");
    if (limit.maxOutputTokensPerTask !== null && summary.output > limit.maxOutputTokensPerTask) violations.push("maximum output tokens per task exceeded");
    if (limit.maxReasoningTokensPerTask !== null && summary.reasoning > limit.maxReasoningTokensPerTask) violations.push("maximum reasoning tokens per task exceeded");
    if (limit.maxTaskDurationMs !== null && this.remainingDurationMs(active.handle.startedAt, now) <= 0) violations.push("maximum task duration exceeded");
    const agentLimit = limit.agentLimits[active.request.agentId];
    if (agentLimit) {
      const period = this.currentPeriod(now);
      const agentSummary = this.ledger.summarize({ agentId: active.request.agentId, from: period.from, to: period.to });
      if (agentLimit.maxReportedCostUsd != null && agentSummary.costUsd > agentLimit.maxReportedCostUsd) violations.push("maximum agent monthly reported USD cost exceeded");
      if (agentLimit.maxTotalTokens != null && agentSummary.total > agentLimit.maxTotalTokens) violations.push("maximum agent monthly tokens exceeded");
    }
    if (violations.length) {
      const error = new BudgetExceededError(violations.join("; "));
      active.handle.abortController.abort(error);
      throw error;
    }
  }

  private startBlockReason(request: BudgetGuardTaskRequest, snapshot: BudgetSnapshot, now: string): string | undefined {
    if (request.startedAt !== undefined && Date.parse(request.startedAt) > Date.parse(now)) return "startedAt cannot be in the future";
    if (this.activeTasks.has(request.taskId)) return `Task ${request.taskId} is already active`;
    if (this.policy.maxConcurrentTasks !== null && this.activeTasks.size >= this.policy.maxConcurrentTasks) return "maximum concurrent tasks reached";
    if (snapshot.status === "blocked") return "extra budget is exhausted or extra RUB payments are recorded for the current month";
    if (request.requiresExtraSpend && !this.policy.extraUsageEnabled) return "extra usage spending is disabled by policy";
    if (this.policy.maxReportedCostUsdPerTask !== null && (request.estimatedCostUsd ?? 0) > this.policy.maxReportedCostUsdPerTask) return "estimated reported USD cost per task exceeds limit";
    if (this.policy.maxTotalTokensPerTask !== null && (request.estimatedTotalTokens ?? 0) > this.policy.maxTotalTokensPerTask) return "estimated total tokens exceed task limit";
    if (this.policy.maxOutputTokensPerTask !== null && (request.estimatedOutputTokens ?? 0) > this.policy.maxOutputTokensPerTask) return "estimated output tokens exceed task limit";
    if (this.policy.maxReasoningTokensPerTask !== null && (request.estimatedReasoningTokens ?? 0) > this.policy.maxReasoningTokensPerTask) return "estimated reasoning tokens exceed task limit";
    if (this.policy.maxTaskDurationMs !== null) {
      if ((request.estimatedDurationMs ?? 0) > this.policy.maxTaskDurationMs) return "estimated task duration exceeds limit";
      if (this.remainingDurationMs(request.startedAt ?? now, now) <= 0) return "maximum task duration already reached";
    }
    const agentLimit = this.policy.agentLimits[request.agentId];
    const used = snapshot.monthlyUsage.byAgent[request.agentId];
    if (agentLimit?.maxReportedCostUsd != null && (used?.costUsd ?? 0) + (request.estimatedCostUsd ?? 0) > agentLimit.maxReportedCostUsd) return "agent monthly reported USD cost limit would be exceeded";
    if (agentLimit?.maxTotalTokens != null && (used?.total ?? 0) + (request.estimatedTotalTokens ?? 0) > agentLimit.maxTotalTokens) return "agent monthly token limit would be exceeded";
    return subscriptionBlockReason(request, snapshot, this.policy);
  }

  private buildSnapshot(now: string): BudgetSnapshot {
    const period = this.currentPeriod(now);
    const monthlyUsage = this.ledger.summarize({ from: period.from, to: period.to });
    const subscriptionPeriod = subscriptionPeriodFor(this.policy, now);
    const subscriptionSummary = this.ledger.summarize({ from: subscriptionPeriod.from, to: subscriptionPeriod.to });
    const currentPayments = [...this.payments.values()].filter((payment) => this.inPeriod(payment.timestamp, period));
    const extraSpendRub = currentPayments.reduce((sum, payment) => sum + payment.amountRub, 0);
    const subscriptionCostRub = this.policy.subscriptionCostRub;
    const extraBudgetRub = subscriptionCostRub === null ? null : this.policy.monthlyBudgetRub - subscriptionCostRub;
    const actualSpendRub = subscriptionCostRub === null && currentPayments.length === 0 ? null : (subscriptionCostRub ?? 0) + extraSpendRub;
    return {
      status: this.statusFor(extraSpendRub, extraBudgetRub),
      allowanceStatus: "unknown",
      monthlyBudgetRub: this.policy.monthlyBudgetRub,
      actualSpendRub,
      subscriptionCostRub,
      extraBudgetRub,
      extraSpendRub,
      extraBudgetRemainingRub: extraBudgetRub === null ? null : extraBudgetRub - extraSpendRub,
      reportedUsageUsd: monthlyUsage.costUsd,
      monthlyUsage,
      activeTaskCount: this.activeTasks.size,
      subscriptionUsage: subscriptionUsageFromSummary(subscriptionSummary, this.policy, subscriptionPeriod),
    };
  }

  private currentPeriod(now: string = this.currentTime()): AccountingPeriod {
    return currentAccountingPeriod(now, this.policy.accountingTimeZone);
  }

  private inPeriod(timestamp: string, period: AccountingPeriod): boolean {
    const time = Date.parse(timestamp);
    return time >= Date.parse(period.from) && time < Date.parse(period.to);
  }

  private currentTime(): string {
    const value = this.clock();
    if (!Number.isFinite(Date.parse(value))) throw new TypeError("budget clock must return a valid ISO timestamp");
    return value;
  }

  getCurrentTime(): string {
    return this.currentTime();
  }

  private ensureUsageLoaded(): Promise<void> {
    this.usageLoaded ??= this.loadUsage().catch((error: unknown) => {
      this.usageLoaded = undefined;
      throw error;
    });
    return this.usageLoaded;
  }

  private async loadUsage(): Promise<void> {
    let records: UsageRecord[];
    try {
      records = await this.store.readUsage();
    } catch (cause) {
      if (cause instanceof BudgetStoreError) throw cause;
      throw new BudgetStoreError("Unable to load usage journal", cause);
    }
    for (const record of records) this.ledger.add(record);
  }

  private requirePaymentStore(): CashPaymentStore {
    const store = this.options.paymentStore;
    if (!store) throw new BudgetStoreError("Cash payment store is not configured: payments would not be persisted");
    return store;
  }

  private ensurePaymentsLoaded(): Promise<void> {
    const store = this.requirePaymentStore();
    this.paymentsLoaded ??= this.loadPayments(store).catch((error: unknown) => {
      this.paymentsLoaded = undefined;
      throw error;
    });
    return this.paymentsLoaded;
  }

  private async loadPayments(store: CashPaymentStore): Promise<void> {
    let records: CashPayment[];
    try {
      records = await store.readPayments();
    } catch (cause) {
      if (cause instanceof BudgetStoreError) throw cause;
      throw new BudgetStoreError("Unable to load cash payment journal", cause);
    }
    for (const record of records) this.payments.set(record.paymentId, record);
  }

  /**
   * Status is computed only from extra RUB payments of the current month against the
   * extra budget (monthly limit minus subscription). Included OpenCode Go quota is
   * not a cash spend. With a zero extra budget any extra payment blocks new tasks.
   */
  private statusFor(extraSpendRub: number, extraBudgetRub: number | null): BudgetSnapshot["status"] {
    if (extraBudgetRub === null) return "unknown";
    if (extraSpendRub > 0 && extraSpendRub >= extraBudgetRub) return "blocked";
    if (extraBudgetRub > 0) {
      const ratio = extraSpendRub / extraBudgetRub;
      if (ratio >= this.policy.criticalThreshold) return "critical";
      if (ratio >= this.policy.warningThreshold) return "warning";
    }
    return "normal";
  }
}
