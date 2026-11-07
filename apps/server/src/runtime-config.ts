import { readFile } from "node:fs/promises";
import type { ModelDescriptor, RuntimeAdapter, RuntimeCapabilities } from "@open-agent-office/shared";
import type { RuntimeManager } from "@open-agent-office/orchestrator";

/**
 * Verified facts supplied by an onboarding layer. The server never discovers
 * credentials or turns a CLI presence check into an authentication claim.
 */
export interface ProductionCodexConfiguration {
  readonly enabled?: boolean;
  readonly command?: string;
  readonly allowedCwdRoots?: readonly string[];
  readonly adapter?: RuntimeAdapter;
  readonly provider?: string;
  readonly modelIds?: readonly string[];
  readonly models?: readonly ModelDescriptor[];
  readonly executableVerified?: boolean;
  readonly protocolVerified?: boolean;
  readonly modelVerified?: boolean;
  readonly providerAvailable?: boolean;
  readonly workspaceApproved?: boolean;
  readonly executionApproved?: boolean;
  readonly availabilityVerified?: boolean;
  readonly authenticationVerified?: boolean;
  readonly approvalGranted?: boolean;
  readonly budgetAdmissionApproved?: boolean;
  readonly source?: string;
  readonly checkedAt?: string;
  readonly preflight?: RuntimePreflightResult;
  readonly preflightPort?: RuntimePreflightPort;
  readonly configurationError?: string;
}

export interface RuntimePreflightPort {
  readonly probe: (input: { readonly runtimeId: "codex" | "opencode"; readonly command: string; readonly args: readonly string[]; readonly timeoutMs: number }) => Promise<{
    readonly executable: boolean;
    readonly protocol: boolean;
    readonly version?: string;
    readonly source?: string;
  }>;
}

export interface RuntimePreflightResult {
  readonly runtimeId: "codex" | "opencode";
  readonly executableVerified: boolean;
  readonly protocolVerified: boolean;
  readonly authenticationVerified: false;
  readonly allowanceVerified: false;
  readonly blockers: readonly string[];
  readonly source: string;
  readonly checkedAt: string;
  readonly version?: string;
}

export interface RuntimeReadinessSnapshot {
  readonly runtimeId: string;
  readonly kind: "fake" | "production";
  readonly provider?: string;
  readonly configured: boolean;
  readonly verified: boolean;
  readonly executable: boolean;
  readonly available: boolean;
  readonly authenticationVerified: boolean;
  readonly supportedModels: readonly string[] | "*";
  readonly capabilities?: RuntimeCapabilities;
  readonly blockers: readonly string[];
  readonly source: string;
  readonly checkedAt?: string;
  readonly registered: boolean;
  readonly protocolVerified: boolean;
  readonly modelVerified: boolean;
  readonly providerAvailable: boolean;
  readonly workspaceApproved: boolean;
  readonly budgetApproved: boolean;
  readonly executionApproved: boolean;
}

export interface ProductionCodexRegistration {
  readonly readiness: RuntimeReadinessSnapshot;
  readonly registered: boolean;
  readonly models: readonly ModelDescriptor[];
}

export interface ProductionOpenCodeConfiguration {
  readonly enabled?: boolean;
  readonly command?: string;
  readonly allowedCwdRoots?: readonly string[];
  readonly adapter?: RuntimeAdapter;
  readonly provider?: string;
  readonly modelIds?: readonly string[];
  readonly models?: readonly ModelDescriptor[];
  readonly executableVerified?: boolean;
  readonly protocolVerified?: boolean;
  readonly modelVerified?: boolean;
  readonly providerAvailable?: boolean;
  readonly workspaceApproved?: boolean;
  readonly executionApproved?: boolean;
  readonly availabilityVerified?: boolean;
  readonly authenticationVerified?: boolean;
  readonly approvalGranted?: boolean;
  readonly budgetAdmissionApproved?: boolean;
  readonly source?: string;
  readonly checkedAt?: string;
  readonly preflight?: RuntimePreflightResult;
  readonly preflightPort?: RuntimePreflightPort;
  readonly configurationError?: string;
}

export interface ProductionOpenCodeRegistration {
  readonly readiness: RuntimeReadinessSnapshot;
  readonly registered: boolean;
  readonly models: readonly ModelDescriptor[];
}

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)];

type LocalRuntimeConfiguration = Omit<ProductionCodexConfiguration, "adapter" | "preflight" | "preflightPort">;
export interface LocalRuntimeConfigurationFile {
  readonly codex?: LocalRuntimeConfiguration;
  readonly openCode?: LocalRuntimeConfiguration;
}

function localRuntime(value: unknown): LocalRuntimeConfiguration | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const strings = (key: string): readonly string[] | undefined => raw[key] === undefined ? undefined : Array.isArray(raw[key]) && raw[key].every(item => typeof item === "string") ? raw[key] as string[] : undefined;
  const modelList = Array.isArray(raw.models) ? raw.models : undefined;
  const validModelList = modelList === undefined || modelList.every(model => {
    if (!model || typeof model !== "object") return false;
    const item = model as Record<string, unknown>;
    return typeof item.id === "string" && typeof item.provider === "string" && Array.isArray(item.runtimeIds) && item.runtimeIds.every(id => typeof id === "string") && Array.isArray(item.capabilities) && typeof item.enabled === "boolean" && typeof item.paidExternal === "boolean" && typeof item.expenseCategory === "string";
  });
  return {
    enabled: raw.enabled === true,
    command: typeof raw.command === "string" ? raw.command : undefined,
    provider: typeof raw.provider === "string" ? raw.provider : undefined,
    modelIds: strings("modelIds"),
    allowedCwdRoots: strings("allowedCwdRoots"),
    models: validModelList ? modelList as ModelDescriptor[] : undefined,
    executableVerified: raw.executableVerified === true,
    protocolVerified: raw.protocolVerified === true,
    modelVerified: raw.modelVerified === true,
    providerAvailable: raw.providerAvailable === true,
    availabilityVerified: raw.availabilityVerified === true,
    authenticationVerified: raw.authenticationVerified === true,
    approvalGranted: raw.approvalGranted === true,
    workspaceApproved: raw.workspaceApproved === true,
    budgetAdmissionApproved: raw.budgetAdmissionApproved === true,
    executionApproved: raw.executionApproved === true,
    source: "local runtime configuration",
    checkedAt: new Date().toISOString(),
    configurationError: validModelList ? undefined : "invalid_model_catalog",
  };
}

/** Loads operator-owned configuration only; it never reads credentials or CLI output. */
export async function loadLocalRuntimeConfiguration(path = process.env.MAO_RUNTIME_CONFIG): Promise<{ readonly codex?: ProductionCodexConfiguration; readonly openCode?: ProductionOpenCodeConfiguration }> {
  if (!path) return {};
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return { codex: localRuntime(parsed.codex), openCode: localRuntime(parsed.openCode) };
  } catch {
    return { codex: { enabled: true, source: "local runtime configuration", configurationError: "invalid_runtime_configuration" }, openCode: undefined };
  }
}

async function runPreflight(runtimeId: "codex" | "opencode", config: { readonly command?: string; readonly preflightPort?: RuntimePreflightPort }): Promise<RuntimePreflightResult> {
  const checkedAt = new Date().toISOString();
  if (!config.preflightPort) return { runtimeId, executableVerified: false, protocolVerified: false, authenticationVerified: false, allowanceVerified: false, blockers: ["preflight_port_not_configured"], source: "server preflight", checkedAt };
  try {
    const result = await config.preflightPort.probe({ runtimeId, command: config.command ?? runtimeId, args: ["--version"], timeoutMs: 5_000 });
    const blockers = [...(result.executable ? [] : ["executable_unverified"]), ...(result.protocol ? [] : ["protocol_unverified"])] as string[];
    return { runtimeId, executableVerified: result.executable, protocolVerified: result.protocol, authenticationVerified: false, allowanceVerified: false, blockers, source: result.source ?? "injected preflight probe", checkedAt, version: result.version };
  } catch {
    return { runtimeId, executableVerified: false, protocolVerified: false, authenticationVerified: false, allowanceVerified: false, blockers: ["preflight_failed"], source: "server preflight", checkedAt };
  }
}

export function preflightCodex(config: Pick<ProductionCodexConfiguration, "command" | "preflightPort">): Promise<RuntimePreflightResult> { return runPreflight("codex", config); }
export function preflightOpenCode(config: Pick<ProductionOpenCodeConfiguration, "command" | "preflightPort">): Promise<RuntimePreflightResult> { return runPreflight("opencode", config); }

function applyPreflight<T extends { readonly executableVerified?: boolean; readonly protocolVerified?: boolean }>(config: T | undefined, result: RuntimePreflightResult | undefined): T | undefined {
  return config && result ? { ...config, executableVerified: result.executableVerified, protocolVerified: result.protocolVerified, checkedAt: (config as T & { readonly checkedAt?: string }).checkedAt ?? result.checkedAt, source: (config as T & { readonly source?: string }).source ?? result.source } : config;
}

export async function resolveProductionCodexConfiguration(config?: ProductionCodexConfiguration): Promise<ProductionCodexConfiguration | undefined> { return applyPreflight(config, config?.preflightPort ? await preflightCodex(config) : config?.preflight); }
export async function resolveProductionOpenCodeConfiguration(config?: ProductionOpenCodeConfiguration): Promise<ProductionOpenCodeConfiguration | undefined> { return applyPreflight(config, config?.preflightPort ? await preflightOpenCode(config) : config?.preflight); }

function readinessFacts(config: { readonly protocolVerified?: boolean; readonly modelVerified?: boolean; readonly providerAvailable?: boolean; readonly availabilityVerified?: boolean; readonly workspaceApproved?: boolean; readonly approvalGranted?: boolean; readonly budgetAdmissionApproved?: boolean; readonly executionApproved?: boolean }, modelsVerified: boolean) {
  // Legacy fields are aliases only; no fact is inferred from HTTP input or CLI presence.
  const protocol = config.protocolVerified ?? true;
  const model = config.modelVerified ?? modelsVerified;
  const provider = config.providerAvailable ?? config.availabilityVerified === true;
  const workspace = config.workspaceApproved ?? config.approvalGranted === true;
  const budget = config.budgetAdmissionApproved === true;
  const execution = config.executionApproved ?? (workspace && budget);
  return { protocol, model, provider, workspace, budget, execution };
}

function validateModels(config: ProductionCodexConfiguration, capabilities: RuntimeCapabilities | undefined, blockers: string[]): readonly ModelDescriptor[] {
  const models = config.models ?? [];
  const modelIds = config.modelIds ?? [];
  if (modelIds.length === 0) blockers.push("no_verified_models");
  if (models.length !== modelIds.length) blockers.push("model_catalog_mismatch");
  if (modelIds.some(model => !model.trim() || model === "*")) blockers.push("model_ids_must_be_explicit");
  if (capabilities && capabilities.supportedModels !== "*") {
    for (const model of modelIds) if (!capabilities.supportedModels.some(prefix => model === prefix || model.startsWith(`${prefix}/`))) blockers.push(`model_not_supported:${model}`);
  }
  for (const model of models) {
    if (!modelIds.includes(model.id)) blockers.push(`model_not_verified:${model.id}`);
    if (model.provider !== (config.provider ?? "chatgpt-plus")) blockers.push(`provider_mismatch:${model.id}`);
    if (!model.runtimeIds.includes("codex")) blockers.push(`runtime_not_pinned:${model.id}`);
  }
  return models;
}

export function registerProductionCodex(runtimeManager: RuntimeManager, config?: ProductionCodexConfiguration): ProductionCodexRegistration {
  const adapter = config?.adapter;
  const capabilities = adapter?.capabilities();
  const modelIds = unique(config?.modelIds ?? []);
  const blockers: string[] = [];
  if (!config) blockers.push("not_configured");
  if (config?.configurationError) blockers.push(config.configurationError);
  if (config?.enabled !== true) blockers.push("disabled_by_configuration");
  if (!adapter) blockers.push("adapter_not_injected");
  if (adapter && String(adapter.id) !== "codex") blockers.push("runtime_id_must_be_codex");
  if (capabilities && String(capabilities.runtimeId) !== "codex") blockers.push("capabilities_runtime_id_must_be_codex");
  const provider = config?.provider ?? "chatgpt-plus";
  if (capabilities && !capabilities.supportedProviders.includes(provider)) blockers.push("provider_not_supported");
  if (config?.executableVerified !== true) blockers.push("executable_unverified");
  if (config?.availabilityVerified !== true) blockers.push("availability_unverified");
  if (config?.authenticationVerified !== true) blockers.push("authentication_unverified");
  if (config?.approvalGranted !== true) blockers.push("onboarding_approval_required");
  if (config?.budgetAdmissionApproved !== true) blockers.push("budget_admission_not_approved");
  const models = validateModels(config ?? {}, capabilities, blockers);
  const facts = readinessFacts(config ?? {}, models.length === modelIds.length && modelIds.length > 0);
  if (!facts.protocol) blockers.push("protocol_unverified");
  if (!facts.model) blockers.push("model_unverified");
  if (!facts.provider) blockers.push("provider_availability_unverified");
  if (!facts.workspace) blockers.push("workspace_not_approved");
  if (!facts.budget) blockers.push("budget_admission_not_approved");
  if (!facts.execution) blockers.push("execution_approval_required");
  const registered = blockers.length === 0;
  if (registered && adapter) runtimeManager.register(adapter);
  return {
    readiness: {
      runtimeId: "codex",
      kind: "production",
      provider,
      configured: config !== undefined,
      verified: config?.authenticationVerified === true && config?.availabilityVerified === true && config?.executableVerified === true && facts.protocol && facts.model && facts.provider && facts.workspace && facts.budget && facts.execution,
      executable: config?.executableVerified === true,
      available: config?.availabilityVerified === true,
      authenticationVerified: config?.authenticationVerified === true,
      supportedModels: modelIds,
      capabilities,
      blockers: [...blockers],
      source: config?.source ?? "unverified configuration",
      checkedAt: config?.checkedAt,
      registered,
      protocolVerified: facts.protocol,
      modelVerified: facts.model,
      providerAvailable: facts.provider,
      workspaceApproved: facts.workspace,
      budgetApproved: facts.budget,
      executionApproved: facts.execution,
    },
    registered,
    models: registered ? models : [],
  };
}

export function registerProductionOpenCode(runtimeManager: RuntimeManager, config?: ProductionOpenCodeConfiguration): ProductionOpenCodeRegistration {
  const adapter = config?.adapter;
  const capabilities = adapter?.capabilities();
  const modelIds = unique(config?.modelIds ?? []);
  const blockers: string[] = [];
  if (!config) blockers.push("not_configured");
  if (config?.configurationError) blockers.push(config.configurationError);
  if (config?.enabled !== true) blockers.push("disabled_by_configuration");
  if (!adapter) blockers.push("adapter_not_injected");
  if (adapter && String(adapter.id) !== "opencode") blockers.push("runtime_id_must_be_opencode");
  if (capabilities && String(capabilities.runtimeId) !== "opencode") blockers.push("capabilities_runtime_id_must_be_opencode");
  const provider = config?.provider ?? "opencode-go";
  if (capabilities && !capabilities.supportedProviders.includes(provider)) blockers.push("provider_not_supported");
  if (config?.executableVerified !== true) blockers.push("executable_unverified");
  if (config?.availabilityVerified !== true) blockers.push("availability_unverified");
  if (config?.authenticationVerified !== true) blockers.push("authentication_unverified");
  if (config?.approvalGranted !== true) blockers.push("onboarding_approval_required");
  if (config?.budgetAdmissionApproved !== true) blockers.push("budget_admission_not_approved");
  const models = config?.models ?? [];
  if (modelIds.length === 0) blockers.push("no_verified_models");
  if (models.length !== modelIds.length) blockers.push("model_catalog_mismatch");
  if (modelIds.some(model => !model.trim() || model === "*")) blockers.push("model_ids_must_be_explicit");
  if (capabilities && capabilities.supportedModels !== "*") for (const model of modelIds) if (!capabilities.supportedModels.some(prefix => model === prefix || model.startsWith(`${prefix}/`))) blockers.push(`model_not_supported:${model}`);
  for (const model of models) {
    if (!modelIds.includes(model.id)) blockers.push(`model_not_verified:${model.id}`);
    if (model.provider !== provider) blockers.push(`provider_mismatch:${model.id}`);
    if (!model.runtimeIds.includes("opencode")) blockers.push(`runtime_not_pinned:${model.id}`);
  }
  const facts = readinessFacts(config ?? {}, models.length === modelIds.length && modelIds.length > 0);
  if (!facts.protocol) blockers.push("protocol_unverified");
  if (!facts.model) blockers.push("model_unverified");
  if (!facts.provider) blockers.push("provider_availability_unverified");
  if (!facts.workspace) blockers.push("workspace_not_approved");
  if (!facts.budget) blockers.push("budget_admission_not_approved");
  if (!facts.execution) blockers.push("execution_approval_required");
  const registered = blockers.length === 0;
  if (registered && adapter) runtimeManager.register(adapter);
  return {
    readiness: {
      runtimeId: "opencode", kind: "production", provider, configured: config !== undefined,
      verified: config?.authenticationVerified === true && config?.availabilityVerified === true && config?.executableVerified === true && facts.protocol && facts.model && facts.provider && facts.workspace && facts.budget && facts.execution,
      executable: config?.executableVerified === true, available: config?.availabilityVerified === true,
      authenticationVerified: config?.authenticationVerified === true, supportedModels: modelIds,
      capabilities, blockers: [...blockers], source: config?.source ?? "unverified configuration", checkedAt: config?.checkedAt, registered,
      protocolVerified: facts.protocol, modelVerified: facts.model, providerAvailable: facts.provider,
      workspaceApproved: facts.workspace, budgetApproved: facts.budget, executionApproved: facts.execution,
    },
    registered, models: registered ? models : [],
  };
}
