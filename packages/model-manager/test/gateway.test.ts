import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { DEFAULT_ROUTING_POLICY, ModelGateway, ModelRoutingError, createModelCatalog } from "../src/index.js";
import { budget, model, profession, runtime, stats, subtask } from "./fixtures.js";

const baseInput = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  subtask: subtask(),
  profession,
  estimatedInputTokens: 100,
  estimatedOutputTokens: 10,
  attempt: 1,
  runtimes: [runtime("opencode")],
  stats: [],
  budget: budget(),
  ...overrides,
});

describe("gateway input validation", () => {
  it("rejects non-positive and non-integer attempts as invalid input", () => {
    const gateway = new ModelGateway(createModelCatalog([model()]));
    for (const attempt of [0, -1, 1.5]) {
      expect(() => gateway.select(baseInput({ attempt }) as never)).toThrow(ModelRoutingError);
      expect(() => gateway.select(baseInput({ attempt }) as never)).toThrow(/attempt/);
    }
  });

  it("rejects corrupt budget snapshots instead of crashing", () => {
    const gateway = new ModelGateway(createModelCatalog([model()]));
    expect(() => gateway.select(baseInput({ budget: undefined }) as never)).toThrow(/budget/);
    expect(() => gateway.select(baseInput({ budget: { status: 42 } }) as never)).toThrow(/budget/);
  });

  it("validates routing policy invariants and impossible combinations", () => {
    for (const bad of [DEFAULT_ROUTING_POLICY, { ...DEFAULT_ROUTING_POLICY, minimumSuccessSample: -1 }, { ...DEFAULT_ROUTING_POLICY, successRateThreshold: 1.2 }, { ...DEFAULT_ROUTING_POLICY, maxFallbacks: -2 }, { ...DEFAULT_ROUTING_POLICY, maxAttempts: 0 }, { ...DEFAULT_ROUTING_POLICY, complexityMinimumTier: 9 }, { ...DEFAULT_ROUTING_POLICY, minimumSuccessSample: 1.5 }]) {
      if (bad === DEFAULT_ROUTING_POLICY) continue;
      expect(() => new ModelGateway(createModelCatalog([model()]), bad)).toThrow(ModelRoutingError);
      expect(() => new ModelGateway(createModelCatalog([model()]), bad)).toThrow(/policy/);
    }
    expect(() => new ModelGateway(createModelCatalog([model()]), DEFAULT_ROUTING_POLICY)).not.toThrow();
  });
});

describe("gateway error classification", () => {
  it("maps missing runtimes to no_runtime_support", () => {
    const gateway = new ModelGateway(createModelCatalog([model()]));
    const error = (() => { try { gateway.select(baseInput({ runtimes: [] }) as never); } catch (caught) { return caught; } })() as ModelRoutingError;
    expect(error.code).toBe("no_runtime_support");
  });

  it("maps capability gaps to missing_capability", () => {
    const gateway = new ModelGateway(createModelCatalog([model({ capabilities: ["code"] })]));
    const caught = (() => { try { gateway.select(baseInput({ subtask: subtask({ requiredCapabilities: ["long-context"] }) }) as never); } catch (caught) { return caught; } })() as ModelRoutingError;
    expect(caught.code).toBe("missing_capability");
    expect(caught.diagnostics[0]).toMatchObject({ reason: "missing_capability:long-context", modelId: "opencode-go/glm-5.3-flash" });
  });

  it("matches supportedModels by exact id or provider prefix only", () => {
    const gateway = new ModelGateway(createModelCatalog([model({ id: "opencode-go/glm-5.3-flash" })]));
    const exact = runtime("opencode", ["opencode-go/glm-5.3-flash"]);
    expect(gateway.select(baseInput({ runtimes: [exact] }) as never).modelId).toBe("opencode-go/glm-5.3-flash");
    const partial = runtime("opencode", ["opencode-go/glm"]);
    expect(() => gateway.select(baseInput({ runtimes: [partial] }) as never)).toThrow(ModelRoutingError);
  });
});

describe("budget gate (read-only projection, ADR-MAO-012)", () => {
  const subscription = (overrides: Record<string, unknown> = {}) => ({ providerId: "chatgpt-plus" as never, subscriptionName: "ChatGPT Plus", requestsUsed: 0, requestLimit: null, approxContextTokensUsed: 0, approxContextTokensLimit: null, periodStart: "2026-11-01T00:00:00.000Z" as never, ...overrides });
  const codexModel = () => model({ id: "chatgpt-plus/plus-model", provider: "chatgpt-plus", runtimeIds: ["codex"], expenseCategory: "subscription", tier: "cheap", capabilities: ["code"] });

  it("gates subscription models only by their own provider's subscription", () => {
    const gateway = new ModelGateway(createModelCatalog([codexModel()]));
    const snapshot = budget({ subscription: subscription({ providerId: "future-provider" as never }) });
    expect(() => gateway.select(baseInput({ runtimes: [runtime("codex")], budget: snapshot }) as never)).toThrow(/no eligible/);
  });

  it("enforces the configured approxContextTokens limit", () => {
    const gateway = new ModelGateway(createModelCatalog([codexModel()]));
    const snapshot = budget({ subscription: subscription({ approxContextTokensLimit: 100 }) });
    expect(() => gateway.select(baseInput({ runtimes: [runtime("codex")], budget: snapshot }) as never)).toThrow(/no eligible/);
    const fine = budget({ subscription: subscription({ approxContextTokensLimit: 1000 }) });
    expect(gateway.select(baseInput({ runtimes: [runtime("codex")], budget: fine }) as never).runtimeId).toBe("codex");
  });

  it("rejects structurally invalid subscription counters as invalid input", () => {
    const gateway = new ModelGateway(createModelCatalog([codexModel()]));
    const snapshot = budget({ subscription: subscription({ requestsUsed: Number.NaN }) });
    expect(() => gateway.select(baseInput({ runtimes: [runtime("codex")], budget: snapshot }) as never)).toThrow(ModelRoutingError);
  });

  it("never debits or reserves anything: budget snapshot stays byte-identical", async () => {
    const gateway = new ModelGateway(createModelCatalog([model()]));
    const snapshot = budget();
    const before = JSON.stringify(snapshot);
    const result = gateway.select(baseInput() as never);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(result.expenseCategory).toBe("free");
  });
});

describe("employeeDefault reserve (API_CONTRACTS §2.5.1)", () => {
  it("falls back to the employee's own model when capability requirements filter out every candidate", () => {
    const gateway = new ModelGateway(createModelCatalog([model({ id: "opencode-go/default", capabilities: ["code"] })]));
    const input = { ...baseInput(), employeeDefault: "opencode-go/default", profession: { ...profession, capabilityRequirements: ["vision"] } };
    const result = gateway.select(input as never);
    expect(result.modelId).toBe("opencode-go/default");
    expect(result.fallbacks).toEqual([]);
    expect(result.rationale).toContain("reserved employee default");
  });

  it("is not applied when the budget is blocked", () => {
    const gateway = new ModelGateway(createModelCatalog([model()]));
    expect(() => gateway.select(baseInput({ employeeDefault: "opencode-go/glm-5.3-flash", budget: budget({ status: "blocked" }) }) as never)).toThrow(ModelRoutingError);
  });

  it("is not applied when the default has no runtime support", () => {
    const gateway = new ModelGateway(createModelCatalog([model()]));
    expect(() => gateway.select(baseInput({ employeeDefault: "opencode-go/glm-5.3-flash", runtimes: [] }) as never)).toThrow(ModelRoutingError);
  });
});

describe("deterministic and read-only gateway behaviour", () => {
  it("returns identical selections for identical inputs regardless of catalog order", () => {
    const entries = [model({ id: "opencode-go/a", relativeCost: 2 }), model({ id: "opencode-go/b", relativeCost: 1 }), model({ id: "opencode-go/c", relativeCost: 3 })];
    let seed = 7;
    const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const reference = new ModelGateway(createModelCatalog(entries)).select(baseInput() as never);
    for (let round = 0; round < 20; round += 1) {
      const shuffled = [...entries].sort(() => rng() - 0.5);
      const gateway = new ModelGateway(createModelCatalog(shuffled));
      const selection = gateway.select(baseInput({ stats: round % 2 === 0 ? [stats({ modelId: "opencode-go/c" as never, attempts: 10, successes: 10, successRate: 1 })] : [stats({ modelId: "opencode-go/c" as never, attempts: 10, successes: 10, successRate: 1 }), stats({ modelId: "opencode-go/c" as never })] }) as never);
      expect(selection).toEqual(reference);
    }
    expect(reference.modelId).toBe("opencode-go/b");
  });

  it("does not mutate deep-frozen input structures", () => {
    const gateway = new ModelGateway(createModelCatalog([model()]));
    const input = Object.freeze({ ...baseInput(), subtask: Object.freeze(subtask()), profession: Object.freeze({ ...profession }), runtimes: Object.freeze([runtime("opencode")]), stats: Object.freeze([]), budget: Object.freeze(budget()) });
    expect(() => gateway.select(input as never)).not.toThrow();
  });

  it("keeps diagnostics free of secrets and task payloads", () => {
    const gateway = new ModelGateway(createModelCatalog([model({ capabilities: ["code"] })]));
    try {
      gateway.select({ ...baseInput({ subtask: subtask({ requiredCapabilities: ["vision"], brief: "TOKEN hunter", title: "secret-title" }) }) } as never);
      throw new Error("expected error");
    } catch (caught) {
      expect(caught).toBeInstanceOf(ModelRoutingError);
      const error = caught as ModelRoutingError;
      for (const diagnostic of error.diagnostics) {
        expect(Object.keys(diagnostic).every((key) => ["modelId", "runtimeId", "reason"].includes(key))).toBe(true);
      }
      expect(JSON.stringify(error)).not.toMatch(/TOKEN hunter|secret-title/);
    }
  });

  it("keeps the previous catalog when a reload fails", async () => {
    const gateway = new ModelGateway(createModelCatalog([model()]));
    expect(gateway.listModels()).toHaveLength(1);
    await expect(gateway.loadCatalog(fileURLToPath(new URL("./missing-on-reload.json", import.meta.url)))).rejects.toThrow(ModelRoutingError);
    expect(gateway.listModels()).toHaveLength(1);
  });
});
