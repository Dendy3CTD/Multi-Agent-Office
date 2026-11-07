import type { BudgetSnapshotView, ModelDescriptor, ModelStatsView, Profession, RuntimeCapabilities, SubtaskBrief } from "@open-agent-office/shared";
import type { RoutingPolicy } from "./router.js";
import type { RoutingDiagnostic } from "./errors.js";

export interface CandidateContext {
  readonly subtask: SubtaskBrief;
  readonly profession: Profession;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens?: number;
  readonly employeeDefault?: string;
  readonly runtimes: readonly RuntimeCapabilities[];
  readonly stats: readonly ModelStatsView[];
  readonly budget: BudgetSnapshotView;
  readonly policy: RoutingPolicy;
}

export interface CandidateResult {
  readonly model: ModelDescriptor;
  readonly runtime: RuntimeCapabilities;
  readonly stats?: ModelStatsView;
}

export interface FilterResult {
  readonly candidates: readonly CandidateResult[];
  readonly diagnostics: readonly RoutingDiagnostic[];
}

const TIER_ORDER: Record<ModelDescriptor["tier"], number> = { free: 0, cheap: 1, standard: 2, strong: 3 };

function supportsModel(capabilities: RuntimeCapabilities, modelId: string): boolean {
  if (capabilities.supportedModels === "*") return true;
  return capabilities.supportedModels.some((prefix) => modelId === prefix || modelId.startsWith(`${prefix}/`));
}

function hasAll(have: readonly string[], required: readonly string[]): string | undefined {
  const set = new Set(have);
  return required.find((item) => !set.has(item));
}

function budgetReason(model: ModelDescriptor, context: CandidateContext): string | undefined {
  if (context.budget.status === "blocked") return "budget_blocked";
  if (model.expenseCategory !== "subscription") return undefined;
  const subscription = context.budget.subscription;
  // ADR-MAO-012: a subscription gates only models of its own provider.
  if (!subscription || subscription.providerId !== model.provider) return "subscription_limit";
  const counters = [subscription.requestsUsed, subscription.approxContextTokensUsed, subscription.requestLimit, subscription.approxContextTokensLimit];
  if (counters.some((value) => value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0))) return "invalid_budget_snapshot";
  if (subscription.requestLimit !== null && subscription.requestsUsed >= subscription.requestLimit) return "subscription_limit";
  if (subscription.approxContextTokensLimit !== null && subscription.approxContextTokensUsed + context.estimatedInputTokens + (context.estimatedOutputTokens ?? 0) > subscription.approxContextTokensLimit) return "subscription_limit";
  return undefined;
}

/** Hard safety gates applied identically to ranked candidates, fallback and reserve. */
export function safetyReject(model: ModelDescriptor, context: CandidateContext): string | undefined {
  if (!model.enabled) return "model_disabled";
  if (model.paidExternal) return "paid_external_requires_approval";
  if (model.maxContextTokens !== undefined) {
    if (context.estimatedOutputTokens === undefined) return "context_limit:output_estimate_unknown";
    if (model.maxContextTokens < context.estimatedInputTokens + context.estimatedOutputTokens) return "context_limit";
  }
  return budgetReason(model, context);
}

/** ModelStatsView must be numerically sane before it influences ranking. */
function isValidStats(stats: ModelStatsView): boolean {
  if (!Number.isInteger(stats.attempts) || stats.attempts < 0 || !Number.isInteger(stats.successes) || stats.successes < 0) return false;
  if (stats.successes > stats.attempts) return false;
  return stats.successRate === undefined || (typeof stats.successRate === "number" && Number.isFinite(stats.successRate) && stats.successRate >= 0 && stats.successRate <= 1);
}

/**
 * Deterministic stats pick: rows with concrete professionId/taskType beat
 * generic rows regardless of the caller's array order; ties keep first-seen.
 */
function pickStats(rows: readonly ModelStatsView[]): ModelStatsView | undefined {
  if (rows.length === 0) return undefined;
  let best = rows[0];
  for (const row of rows) {
    const score = (row.professionId ? 2 : 0) + (row.taskType ? 1 : 0);
    const bestScore = (best.professionId ? 2 : 0) + (best.taskType ? 1 : 0);
    if (score > bestScore) best = row;
  }
  return best;
}

export function filterCandidates(models: readonly ModelDescriptor[], context: CandidateContext): FilterResult {
  if (!Number.isFinite(context.estimatedInputTokens) || context.estimatedInputTokens < 0 || (context.estimatedOutputTokens !== undefined && (!Number.isFinite(context.estimatedOutputTokens) || context.estimatedOutputTokens < 0))) {
    return { candidates: [], diagnostics: [{ reason: "invalid_token_estimate" }] };
  }
  const defaultModel = context.employeeDefault ? models.find((model) => model.id === context.employeeDefault) : undefined;
  const minimumTier = Math.max(TIER_ORDER[context.profession.modelHints.tier], defaultModel ? TIER_ORDER[defaultModel.tier] : 0);
  const minimumCapabilities = new Set([...(defaultModel?.capabilities ?? []), ...context.profession.capabilityRequirements, ...(context.subtask.requiredCapabilities ?? [])]);
  const diagnostics: RoutingDiagnostic[] = [];
  const candidates: CandidateResult[] = [];
  for (const model of models) {
    const reject = (reason: string, runtime?: RuntimeCapabilities) => diagnostics.push({ modelId: model.id, runtimeId: runtime?.runtimeId, reason });
    const safety = safetyReject(model, context);
    if (safety) { reject(safety); continue; }
    if (TIER_ORDER[model.tier] < minimumTier) { reject("below_minimum_tier"); continue; }
    const missing = hasAll(model.capabilities, [...minimumCapabilities]);
    if (missing) { reject(`missing_capability:${missing}`); continue; }
    const runtime = context.runtimes.find((candidate) => model.runtimeIds.includes(candidate.runtimeId) && candidate.supportedProviders.includes(model.provider) && supportsModel(candidate, model.id));
    if (!runtime) { reject("no_runtime_support"); continue; }
    const rows = context.stats.filter((stat) => isValidStats(stat) && stat.modelId === model.id && (!stat.professionId || stat.professionId === context.profession.id) && (!stat.taskType || stat.taskType === context.subtask.taskType));
    candidates.push({ model, runtime, stats: pickStats(rows) });
  }
  return { candidates, diagnostics };
}

export { TIER_ORDER };
