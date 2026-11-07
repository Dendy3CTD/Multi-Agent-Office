import {
  OpenCodeLaunchError,
  OpenCodeRuntime,
  RuntimeError,
  RuntimeAbortError,
  RuntimeEventCallbackError,
  RuntimeExitError,
  RuntimeIncompleteError,
  RuntimeModelError,
  RuntimeProtocolError,
  RuntimeTimeoutError,
  RuntimeUsageCallbackError,
  type RuntimeResult as OpenCodeResult,
  type RuntimeTaskOptions,
  type RuntimeUsage,
} from "./runtime.js";
import { ProductionOpenCodeBackend } from "./backend.js";
import {
  sanitizeValue,
  type RuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeErrorCode,
  type RuntimeEvent,
  type RuntimeExecutionCallbacks,
  type RuntimeExecutionHandle,
  type RuntimeId,
  type RuntimeResult,
  type RuntimeSessionReference,
  type RuntimeTask,
  type UsageMetrics,
} from "@open-agent-office/shared";

/**
 * Adapts the existing OpenCode Runtime (C15) to the unified RuntimeAdapter
 * contract (ADR-MAO-010, API_CONTRACTS §2.16). Wave S2-1: OpenCode only —
 * no RuntimeManager (S2-2), no Codex (S2-3).
 *
 * Compatibility rules:
 * - the OpenCodeRuntime public API is untouched; the adapter wraps runTask;
 * - `cost` of the native RuntimeUsage is mapped to canonical `costUsd`;
 * - the runtime already redacts its events (shared redaction); the adapter
 *   re-sanitizes only when it normalizes raw records into RuntimeEvent;
 * - the OpenCode CLI session id stays an adapter-side value
 *   (externalSessionId) and is never treated as an employee identity.
 */

type UnknownRecord = Readonly<Record<string, unknown>>;

export interface OpenCodeRuntimeAdapterOptions {
  /** Injected runtime (fake in tests); defaults to the real OpenCodeRuntime. */
  readonly runtime?: OpenCodeRuntime;
}

const RETRYABLE_CODES: readonly string[] = ["runtime_timeout", "runtime_protocol", "runtime_exit_nonzero", "runtime_incomplete"];

/** Typed error raised by the adapter; carries the original diagnostic context. */
export class OpenCodeAdapterError extends Error {
  readonly code: RuntimeErrorCode;
  readonly retryable: boolean;
  readonly details?: UnknownRecord;
  override readonly cause?: unknown;

  constructor(message: string, code: RuntimeErrorCode, options: { retryable?: boolean; details?: UnknownRecord; cause?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.cause = options.cause;
  }
}

function objectValue(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
}

function toUsageMetrics(usage: RuntimeUsage): UsageMetrics {
  return {
    input: usage.input,
    output: usage.output,
    reasoning: usage.reasoning,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    total: usage.total,
    costUsd: usage.cost,
  };
}

/** Normalizes a raw OpenCode JSONL record into the shared RuntimeEvent shape. */
function normalizeEvent(event: unknown, runtimeId: RuntimeId): RuntimeEvent {
  const payload = sanitizeValue(event) as UnknownRecord;
  const type = typeof payload.type === "string" ? payload.type : "custom";
  const occurredAt = typeof payload.timestamp === "string" ? payload.timestamp : undefined;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key !== "type" && key !== "timestamp") rest[key] = value;
  }
  return Object.freeze({ type, occurredAt, runtimeId, payload: Object.freeze(rest) });
}

export class OpenCodeRuntimeAdapter implements RuntimeAdapter {
  readonly id: RuntimeId;

  private readonly runtime: OpenCodeRuntime;
  /** Executions in flight, keyed by MAO executionId. */
  private readonly active = new Map<string, AbortController>();

  constructor(options: OpenCodeRuntimeAdapterOptions = {}) {
    this.id = "opencode";
    this.runtime = options.runtime ?? new ProductionOpenCodeBackend({
      supportedModels: [],
      authenticated: false,
      available: false,
      allowedCwdRoots: [process.cwd()],
    });
  }

  capabilities(): RuntimeCapabilities {
    const snapshot = this.runtime.capabilities();
    return Object.freeze({
      runtimeId: this.id,
      runtimeType: "opencode",
      supportedProviders: Object.freeze([snapshot.provider]),
      supportedModels: Object.freeze([...snapshot.supportedModels]),
      session: true,
      /** Continuation via the OpenCode CLI session id; a missing session raises a typed error. */
      sessionResume: true,
      /** AbortSignal → SIGTERM → SIGKILL chain already implemented by C15. */
      cancel: true,
      streamEvents: true,
      usage: true,
      notes: Object.freeze([
        "no adapter-level concurrency ceiling: the MAO work-slot pool (C08) governs parallelism",
        snapshot.authenticated ? "authentication=verified-by-caller" : "authentication=unverified",
        snapshot.available ? "availability=verified-by-caller" : "availability=unverified",
        snapshot.version ? `version=${snapshot.version}` : "version=unverified",
      ]),
    });
  }

  async execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks = {}): Promise<RuntimeResult> {
    if (!task.executionId || task.attempt < 1) {
      throw new OpenCodeAdapterError("executionId and a positive attempt are required", "runtime_protocol");
    }
    if (String(task.runtimeId) !== this.id) {
      throw new OpenCodeAdapterError(`Task runtime ${String(task.runtimeId)} does not match this adapter (${this.id})`, "identifier_conflict");
    }
    const snapshot = this.runtime.capabilities();
    // The base OpenCodeRuntime intentionally has an empty/unverified snapshot
    // for offline compatibility tests. A configured production backend has an
    // explicit model list, so enforce its readiness before touching runTask.
    if (snapshot.supportedModels.length > 0) {
      if (!snapshot.authenticated || !snapshot.available) {
        throw new OpenCodeAdapterError("OpenCode CLI authentication and availability are unverified", "runtime_launch_failed");
      }
      if (!snapshot.supportedModels.includes(task.modelId)) {
        throw new OpenCodeAdapterError("OpenCode model is not confirmed by the runtime catalog", "runtime_model_rejected");
      }
    }
    const controller = new AbortController();
    let relay: (() => void) | undefined;
    if (task.signal) {
      if (task.signal.aborted) controller.abort();
      else {
        relay = () => controller.abort();
        task.signal.addEventListener("abort", relay, { once: true });
      }
    }
    this.active.set(task.executionId, controller);

    const options: RuntimeTaskOptions = {
      model: task.modelId,
      prompt: task.prompt,
      cwd: task.cwd,
      title: task.title ?? `MAO task ${task.executionId}`,
      sessionId: task.sessionId,
      timeoutMs: task.timeoutMs,
      signal: controller.signal,
      onEvent: (event) => { callbacks.onEvent?.(normalizeEvent(event, this.id)); },
      onUsage: (usage, event) => { callbacks.onUsage?.(toUsageMetrics(usage), normalizeEvent(event, this.id)); },
    };

    try {
      const result = await this.runtime.runTask(options);
      return Object.freeze({
        runtimeId: this.id,
        externalSessionId: result.sessionId,
        text: result.text,
        events: Object.freeze(result.events.map((event) => normalizeEvent(event, this.id))),
        exitCode: result.exitCode,
        reason: result.reason,
        usage: toUsageMetrics(result.usage),
      });
    } catch (cause) {
      throw this.toAdapterError(cause);
    } finally {
      this.active.delete(task.executionId);
      if (relay && task.signal) task.signal.removeEventListener("abort", relay);
    }
  }

  /** Aborts a running execution; C15 translates abort into SIGTERM→SIGKILL. */
  async cancel(handle: RuntimeExecutionHandle): Promise<void> {
    if (String(handle.runtimeId) !== this.id) {
      throw new OpenCodeAdapterError(`Execution ${String(handle.executionId)} belongs to runtime ${String(handle.runtimeId)}`, "identifier_conflict");
    }
    const controller = this.active.get(handle.executionId);
    if (!controller) {
      throw new OpenCodeAdapterError(`No active execution for ${handle.executionId}`, "runtime_protocol");
    }
    controller.abort();
  }

  /** Continues an existing OpenCode session (capability-gated; no fake success). */
  async resume(session: RuntimeSessionReference, task: RuntimeTask, callbacks: RuntimeExecutionCallbacks = {}): Promise<RuntimeResult> {
    if (!this.capabilities().sessionResume) {
      throw new OpenCodeAdapterError("This runtime adapter does not support session resume", "unsupported_capability");
    }
    if (String(session.runtimeId) !== this.id || session.resumable !== true) {
      throw new OpenCodeAdapterError("OpenCode session is not owned by this runtime or is not resumable", "identifier_conflict");
    }
    return this.execute({ ...task, sessionId: session.externalSessionId }, callbacks);
  }

  /** Preserves message, stderr, exit code and (already redacted) events. */
  private toAdapterError(cause: unknown): OpenCodeAdapterError {
    if (cause instanceof OpenCodeAdapterError) return cause;
    if (cause instanceof RuntimeError) {
      const code = this.codeFromErrorClass(cause);
      return new OpenCodeAdapterError(cause.message, code, {
        retryable: RETRYABLE_CODES.includes(code),
        details: { stderr: cause.stderr, exitCode: cause.exitCode, eventCount: cause.events.length, events: cause.events },
        cause,
      });
    }
    const message = cause instanceof Error ? cause.message : "Unknown OpenCode runtime failure";
    return new OpenCodeAdapterError(message, "runtime_launch_failed", {
      retryable: false,
      details: cause instanceof Error ? { errorName: cause.name } : undefined,
      cause,
    });
  }

  private codeFromErrorClass(error: RuntimeError): RuntimeErrorCode {
    if (error instanceof OpenCodeLaunchError) return "runtime_launch_failed";
    if (error instanceof RuntimeTimeoutError) return "runtime_timeout";
    if (error instanceof RuntimeAbortError) return "runtime_aborted";
    if (error instanceof RuntimeModelError) return "runtime_model_rejected";
    if (error instanceof RuntimeProtocolError) return "runtime_protocol";
    if (error instanceof RuntimeExitError) return "runtime_exit_nonzero";
    if (error instanceof RuntimeIncompleteError) return "runtime_incomplete";
    if (error instanceof RuntimeEventCallbackError || error instanceof RuntimeUsageCallbackError) return "runtime_callback_failed";
    return "runtime_failed";
  }
}

export function createOpenCodeRuntimeAdapter(options: OpenCodeRuntimeAdapterOptions = {}): OpenCodeRuntimeAdapter {
  return new OpenCodeRuntimeAdapter(options);
}
