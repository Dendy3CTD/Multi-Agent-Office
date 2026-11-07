import { describe, expect, it } from "vitest";
import { rankCandidates, selectionFromCandidates } from "../src/index.js";
import type { CandidateResult } from "../src/candidate-filter.js";
import { model, runtime } from "./fixtures.js";

const candidate = (overrides: Record<string, unknown>, runtimeId = "opencode"): CandidateResult => ({
  model: { ...model(overrides), id: overrides.id ?? "opencode-go/glm-5.3-flash" } as never,
  runtime: JSON.parse(JSON.stringify(runtime(runtimeId))),
});

const policy = { minimumSuccessSample: 3, successRateThreshold: 0.6, maxFallbacks: 2, maxAttempts: 3, complexityMinimumTier: 0 };

describe("candidate ranking (MODEL_ROUTING §3.6)", () => {
  it("orders free above subscription regardless of relative cost", () => {
    const free = candidate({ id: "opencode-go/expensive-free", relativeCost: 5, expenseCategory: "free" });
    const subscription = candidate({ id: "chatgpt-plus/cheap-subscription", provider: "chatgpt-plus", runtimeIds: ["codex"], relativeCost: 0, expenseCategory: "subscription" }, "codex");
    const ranked = rankCandidates([subscription, free], policy);
    expect(ranked[0].model.id).toBe("opencode-go/expensive-free");
  });

  it("orders lower tier first, then cost, within the same financial category", () => {
    const weak = candidate({ id: "opencode-go/weak", relativeCost: 10 });
    const strong = candidate({ id: "opencode-go/strong-model", tier: "strong", relativeCost: 1 });
    const cheap = candidate({ id: "opencode-go/cheap-costly", relativeCost: 10 });
    const ranked = rankCandidates([strong, weak, cheap], policy);
    expect(ranked.map((entry) => entry.model.id)).toEqual(["opencode-go/cheap-costly", "opencode-go/weak", "opencode-go/strong-model"]);
  });

  it("demotes candidates below the complexity tier", () => {
    const escalations = rankCandidates([
      candidate({ id: "opencode-go/small", tier: "cheap" }),
      candidate({ id: "opencode-go/big", tier: "strong", relativeCost: 9 }),
    ], { ...policy, complexityMinimumTier: 2 });
    expect(escalations[0].model.id).toBe("opencode-go/big");
  });

  it("applies a fully deterministic total order", () => {
    const first = candidate({ id: "opencode-go/b" }, "opencode");
    const second = candidate({ id: "opencode-go/a" }, "opencode");
    expect(rankCandidates([first, second], policy)[0].model.id).toBe("opencode-go/a");
  });

  it("honours maxFallbacks and never returns duplicate fallbacks", () => {
    const selection = selectionFromCandidates([
      candidate({ id: "opencode-go/primary" }),
      candidate({ id: "opencode-go/secondary" }),
      candidate({ id: "opencode-go/tertiary" }),
    ], "rationale", 1);
    expect(selection.fallbacks).toEqual(["opencode-go/secondary"]);
    expect(Object.isFrozen(selection.fallbacks)).toBe(true);
  });
});
