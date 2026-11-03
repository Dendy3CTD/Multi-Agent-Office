export type BudgetStatus = "normal" | "warning" | "critical" | "blocked" | "unknown";

export interface UsageMetrics {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  costUsd: number;
}

export interface UsageEventInput extends UsageMetrics {
  eventId?: string;
  agentId: string;
  modelId: string;
  taskId: string;
  projectId?: string;
  sessionId?: string;
  timestamp?: string;
}

export interface UsageRecord extends UsageEventInput {
  eventId: string;
  timestamp: string;
}

export interface UsageTotals extends UsageMetrics {
  eventCount: number;
}

export interface UsageSummary extends UsageTotals {
  byAgent: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
  byTask: Record<string, UsageTotals>;
  byProject: Record<string, UsageTotals>;
  bySession: Record<string, UsageTotals>;
  byDay: Record<string, UsageTotals>;
  byMonth: Record<string, UsageTotals>;
}

export interface UsageFilter {
  agentId?: string;
  modelId?: string;
  taskId?: string;
  projectId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
}

/**
 * Manually recorded extra RUB payment. Only these fields are persisted;
 * descriptions, prompts, tokens and other free text are not accepted.
 */
export interface CashPayment {
  paymentId: string;
  amountRub: number;
  /** ISO timestamp; decides which calendar month the payment belongs to. */
  timestamp: string;
}

/** Limits are evaluated per calendar month of `accountingTimeZone`. */
export interface AgentBudgetLimit {
  maxReportedCostUsd?: number | null;
  maxTotalTokens?: number | null;
}

export interface BudgetPolicyConfig {
  monthlyBudgetRub: number;
  subscriptionCostRub: number | null;
  extraUsageEnabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  maxReportedCostUsdPerTask: number | null;
  maxTotalTokensPerTask: number | null;
  maxOutputTokensPerTask: number | null;
  maxReasoningTokensPerTask: number | null;
  /** Task duration limit; enforced by a timer and on usage events. Must be <= 2^31-1 ms. */
  maxTaskDurationMs: number | null;
  maxConcurrentTasks: number | null;
  agentLimits: Record<string, AgentBudgetLimit>;
  /** IANA time zone that defines calendar-month boundaries. */
  accountingTimeZone: string;
}

export const DEFAULT_BUDGET_POLICY: BudgetPolicyConfig = {
  monthlyBudgetRub: 1000,
  subscriptionCostRub: 1000,
  extraUsageEnabled: false,
  warningThreshold: 0.7,
  criticalThreshold: 0.9,
  maxReportedCostUsdPerTask: null,
  maxTotalTokensPerTask: null,
  maxOutputTokensPerTask: null,
  maxReasoningTokensPerTask: null,
  maxTaskDurationMs: null,
  maxConcurrentTasks: null,
  agentLimits: {},
  accountingTimeZone: "UTC",
};

export interface TaskBudgetRequest {
  taskId: string;
  agentId: string;
  modelId?: string;
  projectId?: string;
  sessionId?: string;
  estimatedCostUsd?: number;
  estimatedTotalTokens?: number;
  estimatedOutputTokens?: number;
  estimatedReasoningTokens?: number;
  estimatedDurationMs?: number;
  requiresExtraSpend?: boolean;
  startedAt?: string;
}

export interface BudgetSnapshot {
  status: BudgetStatus;
  allowanceStatus: "unknown";
  monthlyBudgetRub: number;
  /** subscriptionCostRub + recorded RUB payments; null when subscription is unknown and nothing is recorded. */
  actualSpendRub: number | null;
  subscriptionCostRub: number | null;
  /** monthlyBudgetRub - subscriptionCostRub; null when subscription is unknown. */
  extraBudgetRub: number | null;
  /** Sum of recorded extra RUB payments (0 when none are recorded). */
  extraSpendRub: number;
  /** extraBudgetRub - extraSpendRub; negative values indicate overspending. */
  extraBudgetRemainingRub: number | null;
  reportedUsageUsd: number;
  monthlyUsage: UsageSummary;
  activeTaskCount: number;
}

export interface BudgetDecision {
  allowed: boolean;
  reason: string;
  snapshot: BudgetSnapshot;
}

export interface TaskHandle {
  taskId: string;
  agentId: string;
  abortController: AbortController;
  startedAt: string;
  release(): void;
}

export interface UsageStore {
  appendUsage(record: UsageRecord): Promise<boolean>;
  readUsage(): Promise<UsageRecord[]>;
}

/**
 * Durable journal for manually recorded cash payments.
 * appendPayment returns true when a new record was written, false when an
 * identical record already exists, and throws CashPaymentConflictError when
 * the same paymentId exists with different data.
 */
export interface CashPaymentStore {
  appendPayment(payment: CashPayment): Promise<boolean>;
  readPayments(): Promise<CashPayment[]>;
}
