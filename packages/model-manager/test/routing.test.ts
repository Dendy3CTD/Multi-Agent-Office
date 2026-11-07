import { describe, expect, it } from "vitest";
import { ModelGateway, ModelRoutingError, createModelCatalog } from "../src/index.js";
import { budget, model, profession, runtime, stats, subtask } from "./fixtures.js";

describe("runtime-aware model routing", () => {
  it("selects a confirmed OpenCode model and keeps runtime context", () => {
    const gateway = new ModelGateway(createModelCatalog([model()]));
    const result = gateway.select({ subtask: subtask(), profession, estimatedInputTokens: 100, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime("opencode")], stats: [], budget: budget() });
    expect(result).toMatchObject({ modelId: "opencode-go/glm-5.3-flash", runtimeId: "opencode", provider: "opencode-go" });
  });

  it("selects a synthetic Codex model only when catalog and runtime both confirm it", () => {
    const gateway = new ModelGateway(createModelCatalog([model({ id: "chatgpt-plus/synthetic", provider: "chatgpt-plus", runtimeIds: ["codex"], expenseCategory: "subscription", capabilities: ["code"] })]));
    const result = gateway.select({ subtask: subtask(), profession, estimatedInputTokens: 100, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime("codex")], stats: [], budget: budget({ subscription: { providerId: "chatgpt-plus" as never, subscriptionName: "ChatGPT Plus", requestsUsed: 0, requestLimit: 10, approxContextTokensUsed: 0, approxContextTokensLimit: 10000, periodStart: "2026-11-01T00:00:00.000Z" as never } }) });
    expect(result.runtimeId).toBe("codex");
  });

  it("does not let a fake wildcard Codex runtime invent a model", () => {
    const gateway = new ModelGateway(createModelCatalog([model()]));
    expect(() => gateway.select({ subtask: subtask(), profession, estimatedInputTokens: 100, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime("codex")], stats: [], budget: budget() })).toThrow(ModelRoutingError);
  });

  it("filters provider, capability, context and disabled candidates", () => {
    const gateway = new ModelGateway(createModelCatalog([
      model({ id: "opencode-go/no-reasoning", capabilities: ["code"] }),
      model({ id: "opencode-go/small", maxContextTokens: 10 }),
      model({ id: "opencode-go/disabled", enabled: false }),
      model({ id: "chatgpt-plus/other-pool", provider: "chatgpt-plus", runtimeIds: ["codex"], expenseCategory: "subscription" }),
      model({ id: "opencode-go/good", capabilities: ["code", "reasoning"], maxContextTokens: 1000 }),
    ]));
    const result = gateway.select({ subtask: subtask({ requiredCapabilities: ["reasoning"] }), profession, estimatedInputTokens: 100, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime("opencode")], stats: [], budget: budget() });
    expect(result.modelId).toBe("opencode-go/good");
  });

  it("requires employee default floor and supports complex escalation", () => {
    const gateway = new ModelGateway(createModelCatalog([
      model({ id: "opencode-go/cheap", tier: "cheap" }),
      model({ id: "opencode-go/strong", tier: "strong" }),
    ]));
    const result = gateway.select({ subtask: subtask({ complexity: "complex" }), profession: { ...profession, modelHints: { tier: "cheap" } }, employeeDefault: "opencode-go/cheap", estimatedInputTokens: 100, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime("opencode")], stats: [], budget: budget() });
    expect(result.modelId).toBe("opencode-go/strong");
  });

  it("rejects unknown employee default and unsafe context estimates", () => {
    const gateway = new ModelGateway(createModelCatalog([model({ maxContextTokens: 200 })]));
    expect(() => gateway.select({ subtask: subtask(), profession, employeeDefault: "opencode-go/missing", estimatedInputTokens: 10, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime("opencode")], stats: [], budget: budget() })).toThrow(/employee default/);
    expect(() => gateway.select({ subtask: subtask(), profession, estimatedInputTokens: 10, attempt: 1, runtimes: [runtime("opencode")], stats: [], budget: budget() })).toThrow(ModelRoutingError);
    expect(() => gateway.select({ subtask: subtask(), profession, estimatedInputTokens: -1, attempt: 1, runtimes: [runtime("opencode")], stats: [], budget: budget() })).toThrow(ModelRoutingError);
  });

  it("keeps the cheapest suitable candidate and demotes only proven failures", () => {
    const gateway = new ModelGateway(createModelCatalog([model({ id: "opencode-go/a", relativeCost: 1 }), model({ id: "opencode-go/b", relativeCost: 2 })]));
    // MODEL_ROUTING §1(2)/§3.6: a reliable but costlier model must not outrank
    // a cheaper candidate without proven failure.
    const result = gateway.select({ subtask: subtask(), profession, estimatedInputTokens: 100, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime("opencode")], stats: [stats({ modelId: "opencode-go/b" as never, attempts: 10, successes: 10, successRate: 1 })], budget: budget() });
    expect(result.modelId).toBe("opencode-go/a");

    // A cheaper model with sufficient stats below the threshold is demoted below all.
    const demoted = new ModelGateway(createModelCatalog([model({ id: "opencode-go/a", relativeCost: 1 }), model({ id: "opencode-go/b", relativeCost: 2 })]));
    const failing = demoted.select({ subtask: subtask(), profession, estimatedInputTokens: 100, estimatedOutputTokens: 10, attempt: 1, runtimes: [runtime("opencode")], stats: [stats({ modelId: "opencode-go/a" as never, attempts: 10, successes: 3, successRate: 0.3 })], budget: budget() });
    expect(failing.modelId).toBe("opencode-go/b");
  });
});
