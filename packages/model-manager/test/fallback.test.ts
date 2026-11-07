import { describe, expect, it } from "vitest";
import { ModelGateway, createModelCatalog, decideRetry } from "../src/index.js";
import { budget, model, profession, runtime, subtask } from "./fixtures.js";

describe("fallback and retry", () => {
  it("returns a stable bounded fallback chain", () => {
    const gateway = new ModelGateway(createModelCatalog([
      model({ id: "opencode-go/c", relativeCost: 3 }),
      model({ id: "opencode-go/a", relativeCost: 1 }),
      model({ id: "opencode-go/b", relativeCost: 2 }),
    ]));
    const input = { subtask: subtask(), profession, estimatedInputTokens: 100, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime("opencode")], stats: [], budget: budget() };
    const first = gateway.select(input);
    const second = gateway.select(input);
    expect(first).toEqual(second);
    expect(first.fallbacks).toEqual(["opencode-go/b", "opencode-go/c"]);
    expect(new Set([first.modelId, ...first.fallbacks]).size).toBe(3);
  });

  it("reuses on context failure and advances on model failure", () => {
    const current = { modelId: "opencode-go/a" as never, runtimeId: "opencode" as never, provider: "opencode-go" as never, expenseCategory: "free" as const, rationale: "test", fallbacks: ["opencode-go/b" as never] };
    const next = { ...current, modelId: "opencode-go/b" as never, fallbacks: [] };
    expect(decideRetry({ attempt: 2, maxAttempts: 3, current, fallbackSelections: [next], reason: "context", lastFailure: { verdict: "fail", errorClass: "runtime_protocol" } }).action).toBe("reuse");
    expect(decideRetry({ attempt: 2, maxAttempts: 3, current, fallbackSelections: [next], reason: "model", lastFailure: { verdict: "fail", errorClass: "runtime_model_rejected" } }).selection?.modelId).toBe("opencode-go/b");
  });
});
