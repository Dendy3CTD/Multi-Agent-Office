import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { CatalogValidationError, ModelRoutingError, createModelCatalog, loadCatalog } from "../src/index.js";
import { model } from "./fixtures.js";

describe("Model catalog", () => {
  it("validates and creates an immutable, sorted snapshot", () => {
    const catalog = createModelCatalog([model({ id: "opencode-go/z" }), model()]);
    expect(catalog.list().map((entry) => entry.id)).toEqual(["opencode-go/glm-5.3-flash", "opencode-go/z"]);
    expect(Object.isFrozen(catalog.list())).toBe(true);
    expect(Object.isFrozen(catalog.list()[0])).toBe(true);
  });

  it.each([
    ["duplicate", [model(), model()]],
    ["invalid tier", [model({ tier: "unknown" })]],
    ["invalid provider", [model({ provider: "other" })]],
    ["invalid id", [model({ id: "not-an-id" })]],
    ["invalid expense", [model({ expenseCategory: "subscription" as never, relativeCost: -1 })]],
    ["NaN relativeCost", [model({ relativeCost: Number.NaN })]],
    ["infinite relativeCost", [model({ relativeCost: Number.POSITIVE_INFINITY })]],
    ["non-integer maxContextTokens", [model({ maxContextTokens: 10.5 })]],
    ["empty runtimeIds", [model({ runtimeIds: [] })]],
    ["unknown expenseCategory", [model({ expenseCategory: "barter" })]],
  ])("rejects %s catalog", (_name, entries) => {
    expect(() => createModelCatalog(entries)).toThrow(CatalogValidationError);
  });

  it("rejects paid external models that claim to be free", () => {
    expect(() => createModelCatalog([model({ paidExternal: true, expenseCategory: "money", relativeCost: 10 })])).not.toThrow();
    expect(() => createModelCatalog([model({ paidExternal: true })])).toThrow(/expenseCategory 'free'/);
  });

  it("enforces the fixed provider-runtime pinning (MODEL_ROUTING §1a)", () => {
    expect(() => createModelCatalog([model({ id: "chatgpt-plus/plus", provider: "chatgpt-plus", runtimeIds: ["opencode"], expenseCategory: "subscription" })])).toThrow(/pinned/);
    expect(() => createModelCatalog([model({ id: "chatgpt-plus/plus", provider: "chatgpt-plus", runtimeIds: ["codex"], expenseCategory: "subscription" })])).not.toThrow();
    const custom = new Map([["future-provider", ["custom"]]]);
    expect(() => createModelCatalog([model({ id: "future-provider/f1", provider: "future-provider", runtimeIds: ["custom"] })], { providerRuntimes: custom })).not.toThrow();
    expect(() => createModelCatalog([model({ id: "future-provider/f1", provider: "future-provider", runtimeIds: ["opencode"] })], { providerRuntimes: custom })).toThrow(/pinned/);
  });

  it("rejects empty and unknown model lookup", () => {
    expect(() => createModelCatalog([])).toThrow(ModelRoutingError);
    const catalog = createModelCatalog([model()]);
    expect(() => catalog.get("opencode-go/missing")).toThrow(ModelRoutingError);
  });

  it("rejects unknown expenseCategory and empty arrays correctly", () => {
    expect(() => createModelCatalog([model({ capabilities: [] })])).not.toThrow();
    expect(() => createModelCatalog([model({ capabilities: [""] })])).toThrow(CatalogValidationError);
  });

  it("returns immutable snapshots that cannot be mutated in place", () => {
    const catalog = createModelCatalog([model()]);
    expect(Object.isFrozen(catalog.models)).toBe(true);
    const entry = catalog.get("opencode-go/glm-5.3-flash");
    expect(Object.isFrozen(entry.runtimeIds)).toBe(true);
    expect(Object.isFrozen(entry.capabilities)).toBe(true);
    expect(() => (catalog.list() as unknown[]).push(entry)).toThrow();
  });

  it("reports unreadable catalog files as catalog errors", async () => {
    await expect(loadCatalog(fileURLToPath(new URL("./missing-file.json", import.meta.url)))).rejects.toThrow(CatalogValidationError);
  });

  it("rejects non-array catalog roots", async () => {
    const path = fileURLToPath(new URL("./bad-root.json", import.meta.url));
    await expect(loadCatalog(path)).rejects.toThrow(CatalogValidationError);
  });

  it("loads only the confirmed OpenCode catalog", async () => {
    const catalog = await loadCatalog(fileURLToPath(new URL("../models.config.json", import.meta.url)));
    expect(catalog.list().map((entry) => entry.id)).toEqual([
      "opencode-go/beam-free",
      "opencode-go/glm-5.3-flash",
      "opencode-go/mimo-v2.6-flash",
      "opencode-go/qwen3.8-flash",
    ]);
    expect(catalog.list().every((entry) => entry.runtimeIds.includes("opencode" as never))).toBe(true);
  });
});
