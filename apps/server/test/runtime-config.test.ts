import { describe, expect, it } from "vitest";
import { RuntimeManager } from "@open-agent-office/orchestrator";
import type { ModelDescriptor, RuntimeAdapter, RuntimeCapabilities, RuntimeExecutionCallbacks, RuntimeTask } from "@open-agent-office/shared";
import { loadLocalRuntimeConfiguration, preflightCodex, preflightOpenCode, registerProductionCodex, registerProductionOpenCode } from "../src/runtime-config.js";

const model: ModelDescriptor = { id: "chatgpt-plus/gpt-test", provider: "chatgpt-plus", runtimeIds: ["codex"], tier: "strong", capabilities: ["code"], relativeCost: 1, enabled: true, paidExternal: false, expenseCategory: "subscription" };

function adapterFixture() {
  let executions = 0;
  let cancellations = 0;
  const capabilities: RuntimeCapabilities = { runtimeId: "codex", runtimeType: "codex", supportedProviders: ["chatgpt-plus"], supportedModels: [model.id], session: false, cancel: true, streamEvents: false, usage: true };
  const adapter: RuntimeAdapter = {
    id: "codex",
    capabilities: () => capabilities,
    execute: async (task: RuntimeTask, _callbacks: RuntimeExecutionCallbacks) => { executions += 1; return { runtimeId: "codex", text: `fake:${task.modelId}`, events: [] }; },
    cancel: async () => { cancellations += 1; },
  };
  return { adapter, get executions() { return executions; }, get cancellations() { return cancellations; } };
}

const ready = (adapter: RuntimeAdapter) => registerProductionCodex(new RuntimeManager(), {
  enabled: true, adapter, provider: "chatgpt-plus", modelIds: [model.id], models: [model],
  executableVerified: true, availabilityVerified: true, authenticationVerified: true,
  approvalGranted: true, budgetAdmissionApproved: true, source: "test-onboarding", checkedAt: "2026-11-04T00:00:00.000Z",
});

describe("server Codex production registration seam", () => {
  it("does not register or expose production by default", () => {
    const result = registerProductionCodex(new RuntimeManager());
    expect(result.registered).toBe(false);
    expect(result.readiness.blockers).toEqual(expect.arrayContaining(["not_configured", "adapter_not_injected", "authentication_unverified"]));
  });

  it("requires every verified onboarding fact and never treats CLI presence as auth", () => {
    const fixture = adapterFixture();
    const result = registerProductionCodex(new RuntimeManager(), { enabled: true, adapter: fixture.adapter, modelIds: [model.id], models: [model], executableVerified: true, availabilityVerified: true });
    expect(result.registered).toBe(false);
    expect(result.readiness.authenticationVerified).toBe(false);
    expect(result.readiness.blockers).toEqual(expect.arrayContaining(["authentication_unverified", "onboarding_approval_required", "budget_admission_not_approved"]));
    expect(fixture.executions).toBe(0);
  });

  it("registers an explicitly approved adapter once and preserves provider/model pinning", async () => {
    const fixture = adapterFixture();
    const manager = new RuntimeManager();
    const result = registerProductionCodex(manager, {
      enabled: true, adapter: fixture.adapter, provider: "chatgpt-plus", modelIds: [model.id], models: [model],
      executableVerified: true, availabilityVerified: true, authenticationVerified: true, approvalGranted: true, budgetAdmissionApproved: true,
    });
    expect(result.registered).toBe(true);
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0].supportedProviders).toEqual(["chatgpt-plus"]);
    await manager.execute({ executionId: "server-test:attempt:1", attempt: 1, runtimeId: "codex", modelId: model.id, prompt: "injected test", cwd: "/tmp" });
    expect(fixture.executions).toBe(1);
  });

  it("rejects unsupported models/provider mismatches before registration", () => {
    const fixture = adapterFixture();
    const result = registerProductionCodex(new RuntimeManager(), { enabled: true, adapter: fixture.adapter, provider: "wrong-provider", modelIds: ["chatgpt-plus/unverified"], models: [{ ...model, id: "chatgpt-plus/unverified" }], executableVerified: true, availabilityVerified: true, authenticationVerified: true, approvalGranted: true, budgetAdmissionApproved: true });
    expect(result.registered).toBe(false);
    expect(result.readiness.blockers).toEqual(expect.arrayContaining(["provider_not_supported", "model_not_supported:chatgpt-plus/unverified"]));
  });

  it("keeps duplicate runtime ids as RuntimeManager errors", () => {
    const fixture = adapterFixture();
    const manager = new RuntimeManager();
    registerProductionCodex(manager, { enabled: true, adapter: fixture.adapter, modelIds: [model.id], models: [model], executableVerified: true, availabilityVerified: true, authenticationVerified: true, approvalGranted: true, budgetAdmissionApproved: true });
    expect(() => registerProductionCodex(manager, { enabled: true, adapter: fixture.adapter, modelIds: [model.id], models: [model], executableVerified: true, availabilityVerified: true, authenticationVerified: true, approvalGranted: true, budgetAdmissionApproved: true })).toThrow(/already registered/i);
  });
});

describe("server dual-runtime registration seam", () => {
  it("registers Codex and OpenCode in one RuntimeManager without id conflicts", () => {
    const manager = new RuntimeManager();
    const codex = adapterFixture();
    const openModel: ModelDescriptor = { ...model, id: "opencode-go/test-model", provider: "opencode-go", runtimeIds: ["opencode"] };
    const openAdapter: RuntimeAdapter = { ...codex.adapter, id: "opencode", capabilities: () => ({ ...codex.adapter.capabilities(), runtimeId: "opencode", runtimeType: "opencode", supportedProviders: ["opencode-go"], supportedModels: [openModel.id], session: true, sessionResume: true }) };
    const codexRegistration = registerProductionCodex(manager, { enabled: true, adapter: codex.adapter, provider: "chatgpt-plus", modelIds: [model.id], models: [model], executableVerified: true, availabilityVerified: true, authenticationVerified: true, approvalGranted: true, budgetAdmissionApproved: true });
    const openRegistration = registerProductionOpenCode(manager, { enabled: true, adapter: openAdapter, provider: "opencode-go", modelIds: [openModel.id], models: [openModel], executableVerified: true, availabilityVerified: true, authenticationVerified: true, approvalGranted: true, budgetAdmissionApproved: true });
    expect(codexRegistration.registered).toBe(true); expect(openRegistration.registered).toBe(true); expect(manager.list().map(runtime => runtime.runtimeId).sort()).toEqual(["codex", "opencode"]);
  });

  it("blocks OpenCode when authentication or availability is unknown", () => {
    const fixture = adapterFixture();
    const openModel: ModelDescriptor = { ...model, id: "opencode-go/test-model", provider: "opencode-go", runtimeIds: ["opencode"] };
    const openAdapter: RuntimeAdapter = { ...fixture.adapter, id: "opencode", capabilities: () => ({ ...fixture.adapter.capabilities(), runtimeId: "opencode", supportedProviders: ["opencode-go"], supportedModels: [openModel.id] }) };
    const result = registerProductionOpenCode(new RuntimeManager(), { enabled: true, adapter: openAdapter, provider: "opencode-go", modelIds: [openModel.id], models: [openModel], executableVerified: true, availabilityVerified: false, authenticationVerified: false });
    expect(result.registered).toBe(false); expect(result.readiness.blockers).toEqual(expect.arrayContaining(["availability_unverified", "authentication_unverified"]));
  });
});

describe("explicit runtime preflight", () => {
  it("keeps the fake runtime path independent when no local configuration is provided", async () => {
    expect(await loadLocalRuntimeConfiguration(undefined)).toEqual({});
  });

  it("does not activate an invalid local configuration", async () => {
    const loaded = await loadLocalRuntimeConfiguration("/definitely/missing/mao-runtime.json");
    expect(loaded.codex?.configurationError).toBe("invalid_runtime_configuration");
  });

  it("checks only executable/protocol through an injected port and never authenticates", async () => {
    const calls: unknown[] = [];
    const result = await preflightCodex({ command: "codex-test-only", preflightPort: { probe: async input => { calls.push(input); return { executable: true, protocol: true, version: "test" }; } } });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ runtimeId: "codex", executableVerified: true, protocolVerified: true, authenticationVerified: false, allowanceVerified: false });
    expect(calls[0]).toMatchObject({ command: "codex-test-only", args: ["--version"], timeoutMs: 5000 });
  });

  it("reports failed probes without exposing probe errors", async () => {
    const result = await preflightOpenCode({ preflightPort: { probe: async () => { throw new Error("secret token must not escape"); } } });
    expect(result.blockers).toEqual(["preflight_failed"]);
    expect(JSON.stringify(result)).not.toContain("secret token");
    expect(result.authenticationVerified).toBe(false);
  });

  it("activates only after explicit readiness facts are supplied", () => {
    const fixture = adapterFixture();
    const result = registerProductionCodex(new RuntimeManager(), { enabled: true, adapter: fixture.adapter, modelIds: [model.id], models: [model], executableVerified: true, protocolVerified: true, availabilityVerified: true, providerAvailable: true, authenticationVerified: true, approvalGranted: true, workspaceApproved: true, budgetAdmissionApproved: true, executionApproved: true });
    expect(result.registered).toBe(true);
    expect(result.readiness).toMatchObject({ protocolVerified: true, modelVerified: true, providerAvailable: true, workspaceApproved: true, budgetApproved: true, executionApproved: true });
  });
});
