import { assertTimeZone } from "./accounting-period.js";
import { DEFAULT_BUDGET_POLICY, type BudgetPolicyConfig } from "./types.js";

/** Largest delay accepted by setTimeout; larger values would fire immediately. */
const MAX_TIMER_MS = 2_147_483_647;

export class BudgetPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetPolicyError";
  }
}

export function validateBudgetPolicy(config: BudgetPolicyConfig): BudgetPolicyConfig {
  try {
    assertTimeZone(config.accountingTimeZone);
  } catch (cause) {
    throw new BudgetPolicyError(`accountingTimeZone must be a supported IANA time zone (${(cause as Error).message})`);
  }
  if (config.maxTaskDurationMs !== null && (!Number.isFinite(config.maxTaskDurationMs) || config.maxTaskDurationMs > MAX_TIMER_MS)) {
    throw new BudgetPolicyError(`maxTaskDurationMs must be null or at most ${MAX_TIMER_MS}`);
  }
  if (!Number.isFinite(config.monthlyBudgetRub) || config.monthlyBudgetRub <= 0) throw new BudgetPolicyError("monthlyBudgetRub must be positive");
  if (config.subscriptionCostRub !== null && (!Number.isFinite(config.subscriptionCostRub) || config.subscriptionCostRub < 0)) throw new BudgetPolicyError("subscriptionCostRub must be null or non-negative");
  if (config.subscriptionCostRub !== null && config.subscriptionCostRub > config.monthlyBudgetRub) throw new BudgetPolicyError("subscriptionCostRub cannot exceed monthlyBudgetRub");
  if (!Number.isFinite(config.warningThreshold) || config.warningThreshold < 0 || config.warningThreshold > 1) throw new BudgetPolicyError("warningThreshold must be between 0 and 1");
  if (!Number.isFinite(config.criticalThreshold) || config.criticalThreshold < config.warningThreshold || config.criticalThreshold > 1) throw new BudgetPolicyError("criticalThreshold must be between warningThreshold and 1");
  for (const [name, value] of Object.entries(config)) {
    if (name.startsWith("max") && value !== null && value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) throw new BudgetPolicyError(`${name} must be null or positive`);
  }
  for (const [agentId, limit] of Object.entries(config.agentLimits)) {
    if (!agentId) throw new BudgetPolicyError("agentLimits cannot contain an empty agent id");
    for (const [name, value] of Object.entries(limit)) {
      if (value !== null && value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new BudgetPolicyError(`agentLimits.${agentId}.${name} must be null or positive`);
    }
  }
  return config;
}

export function mergeBudgetPolicy(overrides: Partial<BudgetPolicyConfig> = {}): BudgetPolicyConfig {
  const merged: BudgetPolicyConfig = {
    ...DEFAULT_BUDGET_POLICY,
    ...overrides,
    agentLimits: { ...DEFAULT_BUDGET_POLICY.agentLimits, ...(overrides.agentLimits ?? {}) },
  };
  return validateBudgetPolicy(merged);
}
