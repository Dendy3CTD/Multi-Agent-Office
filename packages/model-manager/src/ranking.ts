import type { ModelDescriptor, ModelSelection } from "@open-agent-office/shared";
import type { CandidateResult } from "./candidate-filter.js";
import type { RoutingPolicy } from "./router.js";

const TIER_ORDER: Record<ModelDescriptor["tier"], number> = { free: 0, cheap: 1, standard: 2, strong: 3 };
const EXPENSE_ORDER: Record<ModelDescriptor["expenseCategory"], number> = { free: 0, subscription: 1, money: 2 };

/**
 * Binary demotion (MODEL_ROUTING §3.6): a model is pushed below every
 * candidate regardless of cost only when a comparable sample exists AND its
 * success rate is below the threshold. Neutral scores (insufficient
 * statistics) never demote and never outrank cheaper candidates.
 */
function failingQuality(candidate: CandidateResult, policy: RoutingPolicy): number {
  const stats = candidate.stats;
  if (!stats || stats.attempts < policy.minimumSuccessSample || stats.attempts === 0) return 0;
  const rate = stats.successRate ?? stats.successes / stats.attempts;
  return rate < policy.successRateThreshold ? 1 : 0;
}

export function rankCandidates(candidates: readonly CandidateResult[], policy: RoutingPolicy): readonly CandidateResult[] {
  return [...candidates].sort((a, b) => {
    const aBelow = TIER_ORDER[a.model.tier] < policy.complexityMinimumTier ? 1 : 0;
    const bBelow = TIER_ORDER[b.model.tier] < policy.complexityMinimumTier ? 1 : 0;
    return aBelow - bBelow
      || failingQuality(a, policy) - failingQuality(b, policy)
      || EXPENSE_ORDER[a.model.expenseCategory] - EXPENSE_ORDER[b.model.expenseCategory]
      || TIER_ORDER[a.model.tier] - TIER_ORDER[b.model.tier]
      || a.model.relativeCost - b.model.relativeCost
      || a.runtime.runtimeId.localeCompare(b.runtime.runtimeId)
      || a.model.id.localeCompare(b.model.id);
  });
}

export function selectionFromCandidates(candidates: readonly CandidateResult[], rationale: string, maxFallbacks: number): ModelSelection {
  const [primary, ...rest] = candidates;
  return Object.freeze({
    modelId: primary.model.id,
    runtimeId: primary.runtime.runtimeId,
    provider: primary.model.provider,
    expenseCategory: primary.model.expenseCategory,
    rationale,
    fallbacks: Object.freeze(rest.slice(0, Math.max(0, maxFallbacks)).map((candidate) => candidate.model.id)),
  });
}
