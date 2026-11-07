import type { ModelSelection } from "@open-agent-office/shared";

export type RetryReason = "context" | "model" | "capability" | "unknown";

export interface RetryInput {
  readonly attempt: number;
  readonly lastFailure?: { readonly verdict: "fail" | "partial"; readonly errorClass?: string };
  readonly current: ModelSelection;
  readonly fallbackSelections: readonly ModelSelection[];
  readonly reason: RetryReason;
  readonly maxAttempts: number;
}

export interface RetryDecision {
  readonly action: "reuse" | "fallback" | "stop";
  readonly selection?: ModelSelection;
  readonly rationale: string;
}

/**
 * §2.5.2 rules: context/unknown → keep the current model; model/capability
 * reasons → move to the next fallback. Retry on runtime change happens only
 * when the fallback selection carries the runtime change (approved policy);
 * duplicates of the just-failed selection never re-enter the chain.
 */
export function decideRetry(input: RetryInput): RetryDecision {
  if (!Number.isInteger(input.attempt) || input.attempt < 1) return { action: "stop", rationale: "attempt out of range" };
  if (input.attempt >= input.maxAttempts || !input.lastFailure) return { action: "stop", rationale: "retry policy exhausted or no failure supplied" };
  if (input.reason === "context" || input.reason === "unknown") return { action: "reuse", selection: input.current, rationale: `reuse current model after ${input.reason} failure` };
  const next = input.fallbackSelections.find((candidate) => !(candidate.modelId === input.current.modelId && candidate.runtimeId === input.current.runtimeId));
  if (!next) return { action: "stop", rationale: "no eligible fallback remains" };
  return { action: "fallback", selection: next, rationale: `select next fallback after ${input.reason} failure` };
}
