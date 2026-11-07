import { readFile } from "node:fs/promises";
import type { ModelDescriptor, ModelId, ProviderId, RuntimeId } from "@open-agent-office/shared";
import { CatalogValidationError, ModelRoutingError } from "./errors.js";

const TIERS = new Set(["free", "cheap", "standard", "strong"]);
const EXPENSES = new Set(["money", "subscription", "free"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Fixed provider→runtime pinning (MODEL_ROUTING §1a): ChatGPT Plus ↔ Codex,
 * opencode-go ↔ OpenCode; cross-binding is forbidden. Unlisted providers carry
 * no declared pin and are accepted.
 */
const DEFAULT_PROVIDER_RUNTIMES: ReadonlyMap<string, readonly string[]> = new Map([
  ["chatgpt-plus", ["codex"]],
  ["opencode-go", ["opencode"]],
]);

export interface CatalogOptions {
  /** Overrides the fixed ADR-MAO-011/§1a pinning table for new providers. */
  readonly providerRuntimes?: ReadonlyMap<string, readonly string[]>;
}

export interface ModelCatalog {
  readonly models: readonly ModelDescriptor[];
  get(modelId: string): ModelDescriptor;
  list(): readonly ModelDescriptor[];
}

function invalid(field: string, message: string): never {
  throw new CatalogValidationError(`${field}: ${message}`);
}

function stringArray(value: unknown, field: string, allowEmpty = false): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    invalid(field, "must be a non-empty string array");
  }
  return Object.freeze([...value]);
}

function parseModel(value: unknown, index: number, providerRuntimes: ReadonlyMap<string, readonly string[]>): ModelDescriptor {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`models[${index}]`, "must be an object");
  const raw = value as Record<string, unknown>;
  const id = raw.id;
  const provider = raw.provider;
  const runtimeIds = stringArray(raw.runtimeIds, `models[${index}].runtimeIds`);
  const capabilities = stringArray(raw.capabilities, `models[${index}].capabilities`, true);
  if (typeof id !== "string" || !ID.test(id)) invalid(`models[${index}].id`, "must use provider/model format");
  if (typeof provider !== "string" || provider.length === 0 || id.split("/", 1)[0] !== provider) invalid(`models[${index}].provider`, "must match the model id provider");
  if (!TIERS.has(raw.tier as string)) invalid(`models[${index}].tier`, "is unknown");
  if (!EXPENSES.has(raw.expenseCategory as string)) invalid(`models[${index}].expenseCategory`, "is unknown");
  if (typeof raw.relativeCost !== "number" || !Number.isFinite(raw.relativeCost) || raw.relativeCost < 0) invalid(`models[${index}].relativeCost`, "must be a non-negative finite number");
  if (typeof raw.enabled !== "boolean") invalid(`models[${index}].enabled`, "must be boolean");
  if (typeof raw.paidExternal !== "boolean") invalid(`models[${index}].paidExternal`, "must be boolean");
  if (raw.paidExternal && raw.expenseCategory === "free") invalid(`models[${index}].paidExternal`, "paid external model cannot declare expenseCategory 'free'");
  const pinned = providerRuntimes.get(provider as string);
  if (pinned && !runtimeIds.every((runtimeId) => pinned.includes(runtimeId))) {
    invalid(`models[${index}].runtimeIds`, `provider '${provider}' is pinned to runtimes [${pinned.join(", ")}]`);
  }
  if (raw.maxContextTokens !== undefined && (typeof raw.maxContextTokens !== "number" || !Number.isInteger(raw.maxContextTokens) || raw.maxContextTokens <= 0)) invalid(`models[${index}].maxContextTokens`, "must be a positive integer");
  const descriptor: ModelDescriptor = {
    id: id as ModelId,
    provider: provider as ProviderId,
    runtimeIds: Object.freeze(runtimeIds.map((runtimeId) => runtimeId as RuntimeId)),
    tier: raw.tier as ModelDescriptor["tier"],
    capabilities,
    relativeCost: raw.relativeCost as number,
    maxContextTokens: raw.maxContextTokens as number | undefined,
    enabled: raw.enabled as boolean,
    paidExternal: raw.paidExternal as boolean,
    expenseCategory: raw.expenseCategory as ModelDescriptor["expenseCategory"],
  };
  return Object.freeze(descriptor);
}

export function createModelCatalog(input: readonly unknown[], options: CatalogOptions = {}): ModelCatalog {
  if (input.length === 0) throw new ModelRoutingError("catalog_empty", "model catalog is empty");
  const pins = options.providerRuntimes ?? DEFAULT_PROVIDER_RUNTIMES;
  const models = input.map((entry, index) => parseModel(entry, index, pins));
  const ids = new Set<string>();
  for (const model of models) {
    if (ids.has(model.id)) throw new CatalogValidationError(`duplicate model id: ${model.id}`);
    ids.add(model.id);
  }
  const snapshot = Object.freeze([...models].sort((a, b) => a.id.localeCompare(b.id)));
  const byId = new Map(snapshot.map((model) => [model.id, model]));
  return Object.freeze({
    models: snapshot,
    get(modelId: string): ModelDescriptor {
      const model = byId.get(modelId);
      if (!model) throw new ModelRoutingError("model_not_found", `model is not in catalog: ${modelId}`);
      return model;
    },
    list(): readonly ModelDescriptor[] { return snapshot; },
  });
}

export async function loadCatalog(path: string, options: CatalogOptions = {}): Promise<ModelCatalog> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new CatalogValidationError(`unable to read catalog: ${cause instanceof Error ? cause.message : "unknown error"}`);
  }
  if (!Array.isArray(parsed)) throw new CatalogValidationError("catalog root must be an array");
  return createModelCatalog(parsed, options);
}
