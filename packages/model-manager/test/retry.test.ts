import { describe, expect, it } from "vitest";
import { decideRetry } from "../src/index.js";
import type { ModelSelection } from "@open-agent-office/shared";

const selection = (modelId: string, runtimeId: string, fallbacks: readonly string[] = []): ModelSelection => ({
  modelId: modelId as never,
  runtimeId: runtimeId as never,
  provider: "opencode-go" as never,
  expenseCategory: "free",
  rationale: "test",
  fallbacks: fallbacks as never[],
});

const opencode = selection("opencode-go/a", "opencode", ["opencode-go/b"]);
const codexFallback = selection("chatgpt-plus/b", "codex", []);
const sameModelOnCodex = selection("opencode-go/a", "codex", []);

describe("retry policy (API_CONTRACTS §2.5.2)", () => {
  it("reuses the current model for context and unknown failures", () => {
    expect(decideRetry({ attempt: 2, maxAttempts: 3, current: opencode, fallbackSelections: [codexFallback], reason: "context", lastFailure: { verdict: "fail", errorClass: "runtime_protocol" } })).toMatchObject({ action: "reuse" });
    expect(decideRetry({ attempt: 2, maxAttempts: 3, current: opencode, fallbackSelections: [codexFallback], reason: "unknown", lastFailure: { verdict: "partial" } })).toMatchObject({ action: "reuse" });
  });

  it("moves to a fallback for model and capability failures", () => {
    expect(decideRetry({ attempt: 2, maxAttempts: 3, current: opencode, fallbackSelections: [codexFallback], reason: "model", lastFailure: { verdict: "fail", errorClass: "runtime_model_rejected" } }).selection?.modelId).toBe("chatgpt-plus/b");
    expect(decideRetry({ attempt: 2, maxAttempts: 3, current: opencode, fallbackSelections: [codexFallback], reason: "capability", lastFailure: { verdict: "fail", errorClass: "runtime_capability" } }).action).toBe("fallback");
  });

  it("allows a runtime change only when the fallback selection itself carries it", () => {
    const decision = decideRetry({ attempt: 2, maxAttempts: 3, current: opencode, fallbackSelections: [codexFallback, sameModelOnCodex], reason: "capability", lastFailure: { verdict: "fail", errorClass: "runtime_capability" } });
    expect(decision.selection?.runtimeId).toBe("codex");
    expect(decision.selection?.modelId).toBe("chatgpt-plus/b");
  });

  it("never re-seats the just-failed selection", () => {
    expect(decideRetry({ attempt: 2, maxAttempts: 3, current: opencode, fallbackSelections: [opencode, codexFallback], reason: "model", lastFailure: { verdict: "fail" } }).selection?.runtimeId).toBe("codex");
  });

  it("stops outside the retry budget, on bad attempts, or without a failure", () => {
    expect(decideRetry({ attempt: 3, maxAttempts: 3, current: opencode, fallbackSelections: [codexFallback], reason: "model", lastFailure: { verdict: "fail" } }).action).toBe("stop");
    for (const attempt of [0, -2, 1.5]) {
      expect(decideRetry({ attempt, maxAttempts: 3, current: opencode, fallbackSelections: [codexFallback], reason: "model", lastFailure: { verdict: "fail" } }).action).toBe("stop");
    }
    expect(decideRetry({ attempt: 2, maxAttempts: 3, current: opencode, fallbackSelections: [codexFallback], reason: "model" }).action).toBe("stop");
  });

  it("stops when only the failed selection remains", () => {
    expect(decideRetry({ attempt: 2, maxAttempts: 3, current: opencode, fallbackSelections: [opencode], reason: "model", lastFailure: { verdict: "fail" } }).rationale).toContain("no eligible fallback remains");
  });
});
