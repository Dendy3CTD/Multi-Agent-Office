import { describe, expect, it } from "vitest";
import { ModelGateway, ModelRoutingError, createModelCatalog } from "../src/index.js";
import { budget, model, profession, runtime, subtask } from "./fixtures.js";

describe("budget and policy", () => {
  const select = (entry: Record<string, unknown>, snapshot = budget()) => new ModelGateway(createModelCatalog([entry])).select({ subtask: subtask(), profession, estimatedInputTokens: 100, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime(entry.provider === "chatgpt-plus" ? "codex" : "opencode")], stats: [], budget: snapshot });

  it("allows free models with unknown provider quota", () => {
    expect(select(model()).expenseCategory).toBe("free");
  });

  it("allows subscription only under a configured, non-exhausted user limit", () => {
    const entry = model({ id: "chatgpt-plus/synthetic", provider: "chatgpt-plus", runtimeIds: ["codex"], expenseCategory: "subscription" });
    const snapshot = budget({ subscription: { providerId: "chatgpt-plus" as never, subscriptionName: "Plus", requestsUsed: 0, requestLimit: 1, approxContextTokensUsed: 0, approxContextTokensLimit: 1000, periodStart: "2026-11-01T00:00:00.000Z" as never } });
    expect(select(entry, snapshot).runtimeId).toBe("codex");
    expect(() => select(entry, budget({ subscription: { ...snapshot.subscription!, requestsUsed: 1 } }))).toThrow(ModelRoutingError);
  });

  it("does not auto-fallback to paid external or run when budget is blocked", () => {
    expect(() => select(model({ paidExternal: true }))).toThrow(ModelRoutingError);
    expect(() => select(model(), budget({ status: "blocked" }))).toThrow(ModelRoutingError);
  });

  it("keeps paid external models out of fallback chains, not only off the primary seat", () => {
    const gateway = new ModelGateway(createModelCatalog([
      model({ id: "opencode-go/first", relativeCost: 1 }),
      model({ id: "opencode-go/paid", paidExternal: true, expenseCategory: "money", relativeCost: 9 }),
    ]));
    const result = gateway.select({ subtask: subtask(), profession, estimatedInputTokens: 100, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime("opencode")], stats: [], budget: budget() });
    expect(result.modelId).toBe("opencode-go/first");
    expect(result.fallbacks).toEqual([]);
  });
});
