import { type EntityId, type ProviderId, type Timestamp } from "./common.js";
import type { ModelId } from "./common.js";
import type { UsageTotals } from "./usage.js";

/**
 * Budget types (C08 Budget Manager + Budget Guard, ADR-MAO-012). Types only:
 * no financial logic here. Key rules encoded by the type shapes:
 * - ChatGPT Plus is a subscription (fixed monthly payment + request/context
 *   counters), never an API balance;
 * - provider quotas are observed, never postulated (`limit: null`);
 * - real money lives in the JSONL ledger of C08 (single source of truth).
 */

/** Which budget a spend counts against (DATA_MODEL §2.6). */
export type ExpenseCategory = "money" | "subscription" | "free" | "local";

/** Health classification reused from the existing C08 policy vocabulary. */
export type BudgetStatus = "normal" | "warning" | "critical" | "blocked" | "unknown";

/** Counters and (user-configured) limits of one subscription. */
export interface SubscriptionUsage {
  readonly providerId: ProviderId;
  readonly subscriptionName: string;
  readonly requestsUsed: number;
  /** User-configured ceiling; `null` = unset (never a claimed provider quota). */
  readonly requestLimit: number | null;
  /** Approximate context spend (estimate from C09/C07), not a token fact. */
  readonly approxContextTokensUsed: number;
  readonly approxContextTokensLimit: number | null;
  readonly periodStart: Timestamp;
  readonly periodEnd?: Timestamp;
}

/**
 * Observed usage of a free provider/model. The provider's real quota is
 * always `null` in MAO: it is intentionally unknown.
 */
export interface ProviderQuotaSnapshot {
  readonly providerId: ProviderId;
  readonly modelId?: ModelId;
  readonly observed: UsageTotals;
  /** Always `null`: quotas are observed, not postulated (ADR-MAO-012). */
  readonly limit: null;
  /** Always `"unknown"`: mirrors C08 `allowanceStatus` (M-04). */
  readonly status: "unknown";
}

/** Scope of a limit. */
export type BudgetLimitScope =
  | { readonly kind: "task"; readonly taskId: EntityId }
  | { readonly kind: "agent"; readonly employeeId: EntityId }
  | { readonly kind: "project"; readonly projectId: EntityId }
  | { readonly kind: "month"; readonly periodStart: Timestamp };

/** A single configured limit; kind defines the unit. */
export type BudgetLimit =
  | { readonly unit: "moneyRub"; readonly value: number; readonly scope: BudgetLimitScope; readonly id: EntityId }
  | { readonly unit: "requests"; readonly value: number; readonly scope: BudgetLimitScope; readonly id: EntityId }
  | { readonly unit: "approxContextTokens"; readonly value: number; readonly scope: BudgetLimitScope; readonly id: EntityId }
  | { readonly unit: "tokens"; readonly value: number; readonly scope: BudgetLimitScope; readonly id: EntityId }
  | { readonly unit: "concurrencySlots"; readonly value: number; readonly scope: BudgetLimitScope; readonly id: EntityId };

/** Snapshot of C08 (canonical shared mirror; C08 keeps its own type until S2-5 mapping). */
export interface BudgetSnapshot {
  readonly generatedAt: Timestamp;
  readonly status: BudgetStatus;
  /** Provider-side allowance is intentionally unknown (M-04). */
  readonly allowanceStatus: "unknown";
  readonly monthlyBudgetRub: number;
  readonly subscriptionCostRub: number | null;
  readonly extraBudgetRemainingRub: number | null;
  readonly reportedUsageUsd: number;
  readonly monthlyUsage: UsageTotals;
  readonly activeTaskCount: number;
  readonly subscription?: SubscriptionUsage;
}

/** Budget Guard verdict snapshot by expense category (DATA_MODEL §2.6). */
export interface BudgetGuardView {
  readonly generatedAt: Timestamp;
  readonly money: { readonly spentRub: number; readonly monthlyBudgetRub: number; readonly remainingRub: number | null; readonly status: BudgetStatus };
  readonly subscription: SubscriptionUsage & { readonly status: BudgetStatus };
  readonly free: readonly ProviderQuotaSnapshot[];
  readonly counts: { readonly requestCountMonth: number; readonly activeExecutions: number; readonly targetWorkSlots: number | null };
  readonly contextEstimate: { readonly approxContextTokensLastExecution: number | null };
}

/** A guard decision produced before (or during) an execution. */
export interface BudgetGuardDecision {
  readonly allowed: boolean;
  /** Set when `allowed === false`; category of the limiting rule. */
  readonly limitCategory?: ExpenseCategory;
  readonly reason: string;
  readonly limit?: BudgetLimit;
  readonly snapshot?: BudgetSnapshot;
}

/** Failure registered by the guard while preparing admission. */
export interface BudgetGuardRejection extends BudgetGuardDecision {
  readonly allowed: false;
  readonly rejectedAt: Timestamp;
  readonly guardId: EntityId;
}
