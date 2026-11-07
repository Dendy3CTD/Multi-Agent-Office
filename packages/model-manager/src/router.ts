import type { BudgetSnapshotView, ModelDescriptor, ModelSelection, ModelStatsView, Profession, RuntimeCapabilities, SubtaskBrief } from "@open-agent-office/shared";
import { ModelRoutingError, type RoutingDiagnostic, type ModelRoutingErrorCode } from "./errors.js";
import { loadCatalog as loadCatalogFile, type ModelCatalog } from "./catalog.js";
import { filterCandidates, safetyReject, type CandidateContext } from "./candidate-filter.js";
import { rankCandidates, selectionFromCandidates } from "./ranking.js";

export interface RoutingPolicy {
  readonly minimumSuccessSample: number;
  readonly successRateThreshold: number;
  readonly maxFallbacks: number;
  readonly maxAttempts: number;
  readonly complexityMinimumTier: number;
}

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = Object.freeze({
  minimumSuccessSample: 3,
  successRateThreshold: 0.6,
  maxFallbacks: 2,
  maxAttempts: 3,
  complexityMinimumTier: 0,
});

export interface ModelRouterInput {
  readonly subtask: SubtaskBrief;
  readonly profession: Profession;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens?: number;
  readonly employeeDefault?: string;
  readonly attempt: number;
  readonly lastFailure?: { readonly verdict: "fail" | "partial"; readonly errorClass?: string };
  /** Caller supplies only runtime snapshots already deemed available. */
  readonly runtimes: readonly RuntimeCapabilities[];
  readonly stats: readonly ModelStatsView[];
  readonly budget: BudgetSnapshotView;
}

export interface ModelRouter {
  loadCatalog(path: string): Promise<void>;
  select(input: ModelRouterInput): ModelSelection;
  listModels(): readonly ModelDescriptor[];
}

const TIER_NAMES = ["free", "cheap", "standard", "strong"] as const;

function validatePolicy(policy: RoutingPolicy): void {
  const problem = !(Number.isInteger(policy.minimumSuccessSample) && policy.minimumSuccessSample >= 0)
    ? "minimumSuccessSample must be a non-negative integer"
    : !(typeof policy.successRateThreshold === "number" && Number.isFinite(policy.successRateThreshold) && policy.successRateThreshold >= 0 && policy.successRateThreshold <= 1)
      ? "successRateThreshold must be a finite number in [0, 1]"
      : !(Number.isInteger(policy.maxFallbacks) && policy.maxFallbacks >= 0)
        ? "maxFallbacks must be a non-negative integer"
        : !(Number.isInteger(policy.maxAttempts) && policy.maxAttempts >= 1)
          ? "maxAttempts must be a positive integer"
          : !(Number.isInteger(policy.complexityMinimumTier) && policy.complexityMinimumTier >= 0 && policy.complexityMinimumTier <= 3)
            ? "complexityMinimumTier must be an integer tier (0..3)"
            : undefined;
  if (problem) throw new ModelRoutingError("invalid_input", `invalid routing policy: ${problem}`);
}

function complexityTier(complexity: SubtaskBrief["complexity"]): number {
  return complexity === "complex" ? 2 : complexity === "standard" ? 1 : 0;
}

function errorCode(diagnostics: readonly RoutingDiagnostic[], runtimesAvailable: boolean): ModelRoutingErrorCode {
  const reasons = diagnostics.map((diagnostic) => diagnostic.reason);
  const has = (needle: string) => reasons.some((reason) => reason.startsWith(needle));
  if (reasons.length === 1 && reasons[0] === "invalid_token_estimate") return "invalid_input";
  if (reasons.length > 0 && reasons.every((reason) => reason === "invalid_budget_snapshot")) return "invalid_input";
  if (has("context_limit")) return "context_limit";
  if (reasons.includes("budget_blocked")) return "budget_blocked";
  if (reasons.includes("invalid_budget_snapshot")) return "invalid_input";
  if (reasons.includes("subscription_limit")) return "subscription_limit";
  if (reasons.includes("paid_external_requires_approval")) return "paid_external_requires_approval";
  if (has("missing_capability")) return "missing_capability";
  if (reasons.length > 0 && reasons.every((reason) => reason === "no_runtime_support")) return "no_runtime_support";
  return runtimesAvailable ? "no_eligible_model" : "no_runtime_support";
}

export class ModelGateway implements ModelRouter {
  private catalog: ModelCatalog;
  private readonly policy: RoutingPolicy;

  constructor(catalog: ModelCatalog, policy: RoutingPolicy = DEFAULT_ROUTING_POLICY) {
    validatePolicy(policy);
    this.catalog = catalog;
    this.policy = Object.freeze({ ...policy });
  }

  async loadCatalog(path: string): Promise<void> {
    // A failed load keeps the previously loaded catalog intact.
    const next = await loadCatalogFile(path);
    this.catalog = next;
  }

  select(input: ModelRouterInput): ModelSelection {
    if (!Number.isInteger(input.attempt) || input.attempt < 1) throw new ModelRoutingError("invalid_input", "attempt must be a positive integer");
    if (!input.budget || typeof input.budget !== "object" || typeof input.budget.status !== "string") throw new ModelRoutingError("invalid_input", "budget snapshot with a status is required");
    if (input.employeeDefault && !this.catalog.models.some((model) => model.id === input.employeeDefault)) {
      throw new ModelRoutingError("model_not_found", `employee default is not in catalog: ${input.employeeDefault}`);
    }
    const policy = { ...this.policy, complexityMinimumTier: Math.max(this.policy.complexityMinimumTier, complexityTier(input.subtask.complexity)) };
    const filtered = filterCandidates(this.catalog.models, { ...input, policy });
    const ranked = rankCandidates(filtered.candidates, policy);
    if (ranked.length === 0) {
      if (input.employeeDefault) {
        const reserve = this.reserve(input);
        if (reserve) return reserve;
      }
      throw new ModelRoutingError(errorCode(filtered.diagnostics, input.runtimes.length > 0), "no eligible model/runtime pair", filtered.diagnostics);
    }
    const selected = selectionFromCandidates(ranked, this.rationale(input, ranked[0]), policy.maxFallbacks);
    return Object.freeze({ ...selected, estimatedTotalTokens: input.estimatedInputTokens + (input.estimatedOutputTokens ?? 0) });
  }

  listModels(): readonly ModelDescriptor[] { return this.catalog.models; }

  /**
   * API_CONTRACTS §2.5.1: when filters leave no candidates, employeeDefault is
   * the reserve choice. The reserve still passes every hard safety gate
   * (enabled, paidExternal, context estimate, budget) and needs real runtime
   * support; capability floors are not applied to the employee's own model.
   */
  private reserve(input: ModelRouterInput): ModelSelection | undefined {
    const defaultModel = this.catalog.models.find((model) => model.id === input.employeeDefault);
    if (!defaultModel) return undefined;
    const context: CandidateContext = {
      subtask: input.subtask,
      profession: input.profession,
      estimatedInputTokens: input.estimatedInputTokens,
      estimatedOutputTokens: input.estimatedOutputTokens,
      runtimes: input.runtimes,
      stats: [],
      budget: input.budget,
      policy: this.policy,
    };
    const reason = safetyReject(defaultModel, context);
    if (reason) return undefined;
    const supported = input.runtimes.some((candidate) => defaultModel.runtimeIds.includes(candidate.runtimeId) && candidate.supportedProviders.includes(defaultModel.provider));
    if (!supported) return undefined;
    return Object.freeze({
      modelId: defaultModel.id,
      runtimeId: input.runtimes.find((candidate) => defaultModel.runtimeIds.includes(candidate.runtimeId) && candidate.supportedProviders.includes(defaultModel.provider))!.runtimeId,
      provider: defaultModel.provider,
      expenseCategory: defaultModel.expenseCategory,
      rationale: `reserved employee default ${defaultModel.id}: no ranked candidate survived the filters${input.attempt > 1 ? `; retry attempt ${input.attempt}` : ""}`,
      fallbacks: Object.freeze([]),
      estimatedTotalTokens: input.estimatedInputTokens + (input.estimatedOutputTokens ?? 0),
    });
  }

  private rationale(input: ModelRouterInput, candidate: { readonly model: ModelDescriptor; readonly runtime: RuntimeCapabilities }): string {
    const retry = input.attempt > 1 ? ` retry attempt ${input.attempt}` : " initial attempt";
    return `selected ${candidate.model.id} on ${candidate.runtime.runtimeId} for ${input.subtask.complexity} task; required capabilities and budget policy satisfied;${retry}`;
  }
}
