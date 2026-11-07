import { currentAccountingPeriod, type AccountingPeriod } from "./accounting-period.js";
import type { BudgetDecision, BudgetPolicyConfig, BudgetSnapshot, ExpenseCategory, TaskBudgetRequest, UsageSummary } from "./types.js";
import type { UsageLedger } from "./usage-ledger.js";
import { DynamicSlotPolicy, type SlotPolicyDecision, type SlotPolicyInput } from "./slot-policy.js";
import { assertBoolean, assertIdentifier, assertNonNegativeNumber, assertOptionalStringIn, normalizeTaskRequest } from "./validation.js";

export interface BudgetGuardTaskRequest extends TaskBudgetRequest {
  readonly expenseCategory?: ExpenseCategory;
  readonly providerId?: string;
  readonly paidExternal?: boolean;
  readonly allowPaidExternal?: boolean;
  readonly estimatedContextTokens?: number;
}

const PROVIDER_MODEL_SPLIT = (modelId: string): string | undefined => {
  const index = modelId.indexOf("/");
  return index > 0 ? modelId.slice(0, index) : undefined;
};

/** providerId, if narrowed down against the model prefix, wins for the classification. */
export function guardProviderOf(input: Pick<BudgetGuardTaskRequest, "providerId" | "modelId">): string {
  return input.providerId ?? PROVIDER_MODEL_SPLIT(input.modelId ?? "") ?? "";
}

/** Providers with a confirmed cost model (ADR-MAO-012); not an extension point without confirmation. */
function isEstablishedProvider(provider: string): boolean {
  return provider === "chatgpt-plus" || provider === "opencode-go" || provider === "free" || provider === "local" || provider.startsWith("local-");
}

/** providerId and the modelId provider must not contradict each other (spoofing protection). */
export function guardProviderConflict(input: Pick<BudgetGuardTaskRequest, "providerId" | "modelId">): boolean {
  const fromProvider = input.providerId;
  const fromModel = input.modelId === undefined ? undefined : PROVIDER_MODEL_SPLIT(input.modelId);
  return fromProvider !== undefined && fromModel !== undefined && fromProvider !== fromModel;
}

/**
 * Validates and Normalizes an extended request Budget Guard. Guard fields are
 * not a trusted route for invalid values: NaN estimates are not allowed to bypass the subscription check,
 * an arbitrary category is not allowed to masquerade as free.
 */
export function normalizeGuardRequest(input: BudgetGuardTaskRequest): BudgetGuardTaskRequest {
  const base = normalizeTaskRequest(input);
  const expenseCategory = assertOptionalStringIn("expenseCategory", input.expenseCategory, ["money", "subscription", "free", "local"] as const);  const providerId = input.providerId === undefined ? undefined : assertIdentifier("providerId", input.providerId);
  const paidExternal = assertBoolean("paidExternal", input.paidExternal);
  const allowPaidExternal = assertBoolean("allowPaidExternal", input.allowPaidExternal);
  const estimatedContextTokens = input.estimatedContextTokens === undefined ? undefined : assertNonNegativeNumber("estimatedContextTokens", input.estimatedContextTokens);
  return { ...base, expenseCategory, providerId, paidExternal, allowPaidExternal, estimatedContextTokens };
}

export interface BudgetGuardView {
  readonly generatedAt: string;
  readonly money: { readonly spentRub: number; readonly monthlyBudgetRub: number; readonly remainingRub: number | null; readonly status: BudgetSnapshot["status"] };
  readonly subscription: NonNullable<BudgetSnapshot["subscriptionUsage"]>;
  readonly free: readonly FreeQuotaView[];
  readonly counts: { readonly requestCountMonth: number; readonly activeExecutions: number; readonly targetWorkSlots: number | null };
  readonly contextEstimate: { readonly approxContextTokensLastExecution: number | null };
}

export interface FreeQuotaView {
  readonly providerId: string;
  readonly modelId?: string;
  readonly observedEventCount: number;
  readonly observedTokens: number;
  readonly limit: null;
  readonly status: "unknown";
}

export interface BudgetGuardDecision extends BudgetDecision {
  readonly category: ExpenseCategory;
  readonly guardView: BudgetGuardView;
}

export interface BudgetGuardSource {
  readonly policy: BudgetPolicyConfig;
  checkTaskStart(request: TaskBudgetRequest): Promise<BudgetDecision>;
  getSnapshot(): Promise<BudgetSnapshot>;
  getUsageSummary(filter?: Parameters<UsageLedger["summarize"]>[0]): Promise<UsageSummary>;
  getCurrentTime(): string;
}

/**
 * Known-provider cost takes priority over a declared category: a caller cannot
 * label a chatgpt-plus model as "free" or an opencode-go model as "money".
 * Without provider evidence the declared category (if valid) is kept, else "money".
 */
export function classifyExpense(input: BudgetGuardTaskRequest): ExpenseCategory {
  const provider = guardProviderOf(input);
  if (provider === "chatgpt-plus") return "subscription";
  if (provider === "opencode-go" || provider === "free") return "free";
  if (provider === "local" || provider.startsWith("local-")) return "local";
  if (input.expenseCategory) return input.expenseCategory;
  return "money";
}

export function subscriptionPeriodFor(policy: BudgetPolicyConfig, now: string): AccountingPeriod {
  const start = policy.subscriptionPeriodStart ?? null;
  const end = policy.subscriptionPeriodEnd ?? null;
  if ((start === null) !== (end === null)) {
    throw new TypeError("subscription period start and end must be configured together");
  }
  if (start !== null && end !== null) {
    return { month: "custom", from: start, to: end };
  }
  return currentAccountingPeriod(now, policy.accountingTimeZone);
}

export function subscriptionUsageFromSummary(summary: UsageSummary, policy: BudgetPolicyConfig, period: AccountingPeriod): BudgetSnapshot["subscriptionUsage"] {
  const entries = Object.entries(summary.byModel).filter(([modelId]) => modelId.split("/", 1)[0] === "chatgpt-plus");
  const requestsUsed = entries.reduce((sum, [, totals]) => sum + totals.eventCount, 0);
  const approxContextTokensUsed = entries.reduce((sum, [, totals]) => sum + totals.total, 0);
  const requestLimit = policy.subscriptionRequestLimit ?? null;
  const contextLimit = policy.subscriptionContextTokensLimit ?? null;
  let status: NonNullable<BudgetSnapshot["subscriptionUsage"]>["status"] = requestLimit === null && contextLimit === null ? "unknown" : "available";
  if (requestLimit !== null && requestsUsed >= requestLimit) status = "blocked";
  if (contextLimit !== null && approxContextTokensUsed >= contextLimit) status = "blocked";
  if (status === "available") {
    const requestRatio = requestLimit === null ? 0 : requestsUsed / requestLimit;
    const contextRatio = contextLimit === null ? 0 : approxContextTokensUsed / contextLimit;
    if (Math.max(requestRatio, contextRatio) >= policy.warningThreshold) status = "warning";
  }
  return {
    requestsUsed,
    requestLimit,
    approxContextTokensUsed,
    approxContextTokensLimit: contextLimit,
    periodStart: period.from,
    periodEnd: period.to,
    status,
  };
}

export function subscriptionBlockReason(input: BudgetGuardTaskRequest, snapshot: BudgetSnapshot, policy: BudgetPolicyConfig): string | undefined {
  if (guardProviderConflict(input)) return "providerId conflicts with the provider prefix of modelId";
  const provider = guardProviderOf(input);
  const established = isEstablishedProvider(provider);
  if (input.paidExternal === true && input.allowPaidExternal !== true) return "paid external execution requires explicit user approval";
  // A declared but unconfirmed provider is never a silently permitted paid
  // route: the caller must either declare the route explicitly free
  // (Model Gateway, paidExternal: false) or carry explicit user approval.
  // Requests with no model information cannot be proven paid and stay allowed.
  if (provider !== "" && !established && input.paidExternal !== false && input.allowPaidExternal !== true) {
    return `unknown provider '${provider}' requires paidExternal: false or explicit user approval`;
  }
  const category = classifyExpense(input);
  if (category !== "subscription") return undefined;
  const usage = snapshot.subscriptionUsage;
  if (!usage) return undefined;
  const extraContext = input.estimatedContextTokens ?? input.estimatedTotalTokens ?? 0;
  if (usage.status === "blocked") return "subscription usage limit is exhausted";
  if (policy.subscriptionRequestLimit != null && usage.requestsUsed + 1 > policy.subscriptionRequestLimit) return "subscription request limit would be exceeded";
  if (policy.subscriptionContextTokensLimit != null && usage.approxContextTokensUsed + extraContext > policy.subscriptionContextTokensLimit) return "subscription approximate context limit would be exceeded";
  return undefined;
}

export class BudgetGuard {
  readonly slotPolicy = new DynamicSlotPolicy();

  constructor(private readonly source: BudgetGuardSource) {}

  classify(input: BudgetGuardTaskRequest): ExpenseCategory {
    return classifyExpense(input);
  }

  async precheck(request: BudgetGuardTaskRequest): Promise<BudgetGuardDecision> {
    const normalized = normalizeGuardRequest(request);
    const base = await this.source.checkTaskStart(normalized);
    const guardReason = subscriptionBlockReason(normalized, base.snapshot, this.source.policy);
    // The guard's own safety checks run whenever the source admitted the
    // request; a source rejection wins, the guard must not mask it.
    const reason = base.allowed ? guardReason : base.reason;
    const guardView = await this.view();
    return { ...base, allowed: reason === undefined, reason: reason ?? base.reason, category: this.classify(normalized), guardView };
  }

  async view(): Promise<BudgetGuardView> {
    const snapshot = await this.source.getSnapshot();
    const now = this.source.getCurrentTime();
    const period = subscriptionPeriodFor(this.source.policy, now);
    const summary = await this.source.getUsageSummary({ from: period.from, to: period.to });
    const monthPeriod = currentAccountingPeriod(now, this.source.policy.accountingTimeZone);
    const monthSummary = await this.source.getUsageSummary({ from: monthPeriod.from, to: monthPeriod.to });
    const free = Object.entries(summary.byModel)
      .filter(([modelId]) => ["opencode-go", "free"].includes(modelId.split("/", 1)[0]))
      .map(([modelId, totals]) => ({ providerId: modelId.split("/", 1)[0], modelId, observedEventCount: totals.eventCount, observedTokens: totals.total, limit: null as null, status: "unknown" as const }));
    return {
      generatedAt: now,
      money: { spentRub: snapshot.actualSpendRub ?? 0, monthlyBudgetRub: snapshot.monthlyBudgetRub, remainingRub: snapshot.extraBudgetRemainingRub, status: snapshot.status },
      subscription: snapshot.subscriptionUsage ?? { requestsUsed: 0, requestLimit: this.source.policy.subscriptionRequestLimit ?? null, approxContextTokensUsed: 0, approxContextTokensLimit: this.source.policy.subscriptionContextTokensLimit ?? null, periodStart: period.from, periodEnd: period.to, status: "unknown" },
      free,
      counts: { requestCountMonth: monthSummary.eventCount, activeExecutions: snapshot.activeTaskCount, targetWorkSlots: null },
      contextEstimate: { approxContextTokensLastExecution: null },
    };
  }

  computeSlots(input: SlotPolicyInput): SlotPolicyDecision {
    return this.slotPolicy.compute(input);
  }
}
