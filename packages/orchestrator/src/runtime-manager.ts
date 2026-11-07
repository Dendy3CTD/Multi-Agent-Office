import {
  type EntityId,
  type ErrorCode,
  type RuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeCapabilityReport,
  type RuntimeExecutionCallbacks,
  type RuntimeExecutionHandle,
  type RuntimeId as ContractRuntimeId,
  type RuntimeManagerContract,
  type RuntimeRequirement,
  type RuntimeResult,
  type RuntimeSessionBinding,
  type RuntimeTask,
} from "@open-agent-office/shared";

/**
 * C17 Runtime Manager (ADR-MAO-010, API_CONTRACTS §2.17, wave S2-2).
 * Registry of RuntimeAdapter implementations plus deterministic dispatch:
 * registration integrity, capability verification before dispatch,
 * execution isolation per runtime, session binding ownership.
 *
 * Not included (later waves): Model Gateway routing/selection (S2-4),
 * Codex adapter (S2-3), event-bus wiring (integral orchestrator waves).
 */

/** Structured failure of the Runtime Manager itself. */
export class RuntimeManagerError extends Error {
  readonly code: ErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(message: string, code: ErrorCode, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** Matches a model id against declared prefixes; `"*"` accepts every model. */
export function supportsModel(capabilities: RuntimeCapabilities, modelId: string): boolean {
  if (capabilities.supportedModels === "*") return true;
  return capabilities.supportedModels.some((prefix) => modelId === prefix || modelId.startsWith(`${prefix}/`));
}

/** Returns requested requirements that the adapter does NOT declare. */
export function missingRequirements(
  capabilities: RuntimeCapabilities,
  requirements: readonly RuntimeRequirement[],
): readonly RuntimeRequirement[] {
  return requirements.filter((requirement) => capabilities[requirement] !== true);
}

export interface RuntimeManagerOptions {
  /** Reserved for composition-root tuning; kept for construction-time policy. */
  readonly maxTrackedExecutions?: number;
}

interface RegisteredRuntime {
  readonly adapter: RuntimeAdapter;
  readonly capabilities: RuntimeCapabilities;
}

interface ActiveExecution {
  readonly handle: RuntimeExecutionHandle;
  readonly adapter: RuntimeAdapter;
}

export class RuntimeManager implements RuntimeManagerContract {
  private readonly runtimes = new Map<string, RegisteredRuntime>();
  private readonly active = new Map<string, ActiveExecution>();
  private readonly sessions = new Map<string, { readonly binding: RuntimeSessionBinding }>();

  constructor(private readonly options: RuntimeManagerOptions = {}) {}

  /** Registers an adapter; silent replacement of an existing Runtime is forbidden. */
  register(adapter: RuntimeAdapter): void {
    if (!adapter || typeof adapter.execute !== "function" || typeof adapter.capabilities !== "function") {
      throw new RuntimeManagerError("adapter must implement RuntimeAdapter", "validation_error");
    }
    const capabilities = adapter.capabilities();
    const runtimeId = String(capabilities.runtimeId);
    if (this.runtimes.has(runtimeId)) {
      throw new RuntimeManagerError(`Runtime already registered: ${runtimeId}`, "identifier_conflict", { runtimeId });
    }
    if (String(adapter.id) !== runtimeId) {
      throw new RuntimeManagerError("adapter.id must equal capabilities.runtimeId", "validation_error", {
        adapterId: String(adapter.id),
        runtimeId,
      });
    }
    this.runtimes.set(runtimeId, { adapter, capabilities });
  }

  list(): readonly RuntimeCapabilities[] {
    return Array.from(this.runtimes.values(), (registered) => registered.capabilities);
  }

  get(runtimeId: ContractRuntimeId): RuntimeAdapter {
    const registered = this.runtimes.get(String(runtimeId));
    if (!registered) {
      throw new RuntimeManagerError(`Runtime is not registered: ${String(runtimeId)}`, "not_found", { runtimeId: String(runtimeId) });
    }
    return registered.adapter;
  }

  /** Deterministic capability-based pick in registration order (no LLM routing here). */
  resolveFor(modelId: string, requireAll: readonly RuntimeRequirement[] = []): RuntimeAdapter {
    let declared = false;
    for (const registered of this.runtimes.values()) {
      if (supportsModel(registered.capabilities, modelId)) {
        declared = true;
        if (missingRequirements(registered.capabilities, requireAll).length === 0) return registered.adapter;
      }
    }
    if (declared) {
      throw new RuntimeManagerError(`Registered runtimes support ${modelId} but not with all requested capabilities`, "unsupported_capability", {
        modelId,
        requirements: [...requireAll],
      });
    }
    throw new RuntimeManagerError(`No registered runtime supports model ${modelId}`, "not_found", { modelId });
  }

  execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks = {}): Promise<RuntimeResult> {
    const runtimeId = String(task.runtimeId);
    const registered = this.runtimes.get(runtimeId);
    if (!registered) {
      return Promise.reject(new RuntimeManagerError(`Runtime is not registered: ${runtimeId}`, "not_found", { runtimeId }));
    }
    if (!supportsModel(registered.capabilities, task.modelId)) {
      return Promise.reject(new RuntimeManagerError(
        `Runtime ${runtimeId} does not declare support for model ${task.modelId}`,
        "unsupported_capability",
        { runtimeId, modelId: task.modelId },
      ));
    }
    const handle: RuntimeExecutionHandle = { executionId: task.executionId, runtimeId: task.runtimeId };
    const key = String(task.executionId);
    // Duplicate in-flight execution ids would silently overwrite each other and
    // corrupt cancellation ownership: they are rejected at admission instead.
    if (this.active.has(key)) {
      return Promise.reject(new RuntimeManagerError(
        `Execution ${key} is already in flight`,
        "identifier_conflict",
        { executionId: key, runtimeId },
      ));
    }
    this.active.set(key, { handle, adapter: registered.adapter });
    try {
      return registered.adapter.execute(task, callbacks).finally(() => {
        // Completed and failed executions leave the registry immediately (§3.4).
        this.active.delete(String(task.executionId));
      });
    } catch (cause) {
      this.active.delete(String(task.executionId));
      return Promise.reject(cause);
    }
  }

  /** Cancels strictly through the runtime that owns the execution (§3.4 isolation). */
  async cancel(handle: RuntimeExecutionHandle): Promise<void> {
    const key = String(handle.executionId);
    const entry = this.active.get(key);
    if (!entry) {
      throw new RuntimeManagerError(`No active execution for ${key}`, "not_found", { executionId: key });
    }
    if (String(entry.handle.runtimeId) !== String(handle.runtimeId)) {
      throw new RuntimeManagerError(
        `Execution ${key} belongs to runtime ${String(entry.handle.runtimeId)}`,
        "identifier_conflict",
        { executionId: key, requestedRuntimeId: String(handle.runtimeId), ownerRuntimeId: String(entry.handle.runtimeId) },
      );
    }
    const cancel = entry.adapter.cancel;
    if (!cancel) {
      throw new RuntimeManagerError(`Runtime ${String(handle.runtimeId)} does not declare cancel`, "unsupported_capability", {
        runtimeId: String(handle.runtimeId),
      });
    }
    await cancel.call(entry.adapter, handle);
  }

  listActiveExecutions(): readonly RuntimeExecutionHandle[] {
    return Array.from(this.active.values(), (entry) => entry.handle);
  }

  checkCapabilities(runtimeId: ContractRuntimeId, requirements: readonly RuntimeRequirement[]): RuntimeCapabilityReport {
    const capabilities = this.get(runtimeId).capabilities();
    const missing = missingRequirements(capabilities, requirements);
    return { runtimeId, satisfied: missing.length === 0, missing };
  }

  /** Records an adapter-side session bound to one runtime (§3.5). */
  bindSession(binding: RuntimeSessionBinding): void {
    const key = String(binding.sessionId);
    this.get(binding.runtimeId); // refuses bindings pointing at unknown runtimes
    const existing = this.sessions.get(key);
    if (existing && String(existing.binding.runtimeId) !== String(binding.runtimeId)) {
      throw new RuntimeManagerError(
        `Session ${key} is already bound to runtime ${String(existing.binding.runtimeId)}`,
        "identifier_conflict",
        { sessionId: key, existingRuntimeId: String(existing.binding.runtimeId), requestedRuntimeId: String(binding.runtimeId) },
      );
    }
    this.sessions.set(key, { binding });
  }

  /** Resumes strictly through the owning runtime; a foreign runtime is refused before any adapter call. */
  resumeSession(
    sessionId: EntityId,
    task: RuntimeTask,
    callbacks: RuntimeExecutionCallbacks = {},
  ): Promise<RuntimeResult> {
    const key = String(sessionId);
    const entry = this.sessions.get(key);
    if (!entry) {
      return Promise.reject(new RuntimeManagerError(`No session bound for ${key}`, "not_found", { sessionId: key }));
    }
    const ownerRuntimeId = String(entry.binding.runtimeId);
    if (String(task.runtimeId) !== ownerRuntimeId) {
      return Promise.reject(new RuntimeManagerError(
        `Session ${key} belongs to runtime ${ownerRuntimeId}, not ${String(task.runtimeId)}`,
        "identifier_conflict",
        { sessionId: key, ownerRuntimeId, requestedRuntimeId: String(task.runtimeId) },
      ));
    }
    const adapter = this.get(entry.binding.runtimeId);
    const resume = adapter.resume;
    if (!adapter.capabilities().sessionResume || !resume) {
      return Promise.reject(new RuntimeManagerError(
        `Runtime ${ownerRuntimeId} does not declare sessionResume`,
        "unsupported_capability",
        { runtimeId: ownerRuntimeId },
      ));
    }
    const externalSessionId = entry.binding.externalSessionId ? entry.binding.externalSessionId : task.sessionId;
    const session = { runtimeId: entry.binding.runtimeId, externalSessionId: externalSessionId ?? "", resumable: true };
    return resume.call(adapter, session, task, callbacks);
  }
}

/** Convenience factory used by composition roots (C16) and tests. */
export function createRuntimeManager(options: RuntimeManagerOptions = {}): RuntimeManager {
  return new RuntimeManager(options);
}
