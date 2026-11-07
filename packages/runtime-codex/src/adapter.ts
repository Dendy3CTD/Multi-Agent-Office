import {
  redactSecrets,
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
import {
  CodexBackendFailure,
  type CodexBackend,
  type CodexBackendTask,
  type CodexNativeEvent,
  type CodexNativeUsage,
} from "./backend.js";

/**
 * Codex Runtime adapter (C18) over the transport boundary {@link CodexBackend}
 * (ADR-MAO-010, API_CONTRACTS §2.16, wave S2-3). The wired backend is
 * `FakeCodexBackend` only: real Codex CLI transport, event format, resume and
 * authorization are deferred compatibility gates, never emulated.
 *
 * Honesty rules:
 * - capabilities mirror the wired backend (the adapter adds identity + notes);
 * - unsupported capabilities fail typed (`unsupported_capability`), never fake success;
 * - `runtime_failed` is the deterministic fallback for unknown native failures;
 * - raw records are sanitized once at the adapter boundary (shared redaction);
 * - the adapter never queries OpenAI, never touches ChatGPT auth material.
 */

type UnknownRecord = Readonly<Record<string, unknown>>;

interface ActiveRun {
  readonly executionId: string;
  readonly cancel: () => void;
}

export interface CodexRuntimeAdapterOptions {
  readonly backend: CodexBackend;
}

/** Typed error raised by the Codex adapter; mirrors the unified RuntimeError shape. */
export class CodexAdapterError extends Error {
  readonly code: RuntimeErrorCode;
  readonly retryable: boolean;
  readonly details?: UnknownRecord;
  override readonly cause?: unknown;

  constructor(message: string, code: RuntimeErrorCode, options: { retryable?: boolean; details?: UnknownRecord; cause?: unknown } = {}) {
    // Diagnostics are a public channel: messages and details are sanitized at the border (P1-3).
    super(redactSecrets(message));
    this.name = new.target.name;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details === undefined ? undefined : (sanitizeValue(options.details) as UnknownRecord);
    this.cause = options.cause;
  }
}

/** Same retryability vocabulary as the OpenCode adapter (S2-1). */
const RETRYABLE_CODES: readonly string[] = ["runtime_timeout", "runtime_protocol", "runtime_exit_nonzero", "runtime_incomplete"];

/** Deterministic code mapping from backend failure kinds (no invented codes). */
function codeFromFailureKind(kind: CodexBackendFailure["kind"]): RuntimeErrorCode {
  switch (kind) {
    case "model": return "runtime_model_rejected";
    case "exit": return "runtime_exit_nonzero";
    case "abort": return "runtime_aborted";
    case "callback": return "runtime_callback_failed";
    case "config": return "runtime_launch_failed";
    case "timeout": return "runtime_timeout";
    case "protocol": return "runtime_protocol";
    case "unknown": return "runtime_failed";
  }
}

function toUsageMetrics(usage: CodexNativeUsage): UsageMetrics {
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

function normalizeEvent(record: CodexNativeEvent, runtimeId: RuntimeId): RuntimeEvent {
  const payload = sanitizeValue(record) as UnknownRecord;
  const type = typeof payload.type === "string" ? payload.type : "custom";
  const occurredAt = typeof payload.timestamp === "string" ? payload.timestamp : undefined;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key !== "type" && key !== "timestamp") rest[key] = value;
  }
  return Object.freeze({ type, occurredAt, runtimeId, payload: Object.freeze(rest) });
}

/**
 * Security boundary (P1-3), documented in code:
 * - delivered event records are sanitized at the adapter boundary → no secrets leave through events;
 * - error/diagnostic surfaces (`.message`, `.details`) are sanitized (`redactSecrets`) — diagnostics are a public channel;
 * - `RuntimeResult.text` is the TRUSTED result channel: generated model output passes through unchanged, as agreed by the
 *   result contract (same semantics as C15 `RuntimeResult.text`). Flows into archives via C14 with their own redaction policy.
 */
export class CodexRuntimeAdapter implements RuntimeAdapter {
  readonly id: RuntimeId;

  private readonly backend: CodexBackend;
  /** Adapter-owned in-flight ids (defensive, adapter-local; the global registry is RuntimeManager's). */
  private readonly active = new Map<string, ActiveRun>();

  constructor(options: CodexRuntimeAdapterOptions) {
    this.id = "codex";
    this.backend = options.backend;
  }

  capabilities(): RuntimeCapabilities {
    const backend = this.backend.capabilities();
    return Object.freeze({
      ...backend,
      runtimeId: this.id,
      runtimeType: "codex",
      notes: Object.freeze([
        "S2-3: capabilities mirror the wired backend (FakeCodexBackend); production Codex CLI transport is a deferred compatibility gate",
        "sessionResume is undeclared: session continuity of the production CLI is unverified (never emulated)",
        "ChatGPT Plus subscription is not an API balance; no paid fallback and no unofficial authorization (ADR-MAO-012)",
        ...((backend.notes as readonly string[] | undefined) ?? []),
      ]),
    });
  }

  async execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks = {}): Promise<RuntimeResult> {
    if (!task.executionId || task.attempt < 1) {
      throw new CodexAdapterError("executionId and a positive attempt are required", "runtime_protocol");
    }
    // P1-2: foreign runtime id is refused before the backend is even touched.
    if (String(task.runtimeId) !== this.id) {
      throw new CodexAdapterError(
        `Task runtime ${String(task.runtimeId)} does not match this adapter (${this.id})`,
        "identifier_conflict",
        { details: { requestedRuntimeId: String(task.runtimeId), runtimeId: this.id } },
      );
    }
    if (this.active.has(task.executionId)) {
      throw new CodexAdapterError(`Execution ${task.executionId} is already in flight in this adapter`, "identifier_conflict", {
        details: { executionId: task.executionId },
      });
    }
    if (task.signal?.aborted) {
      // Same fast-fail as C15: an already-aborted signal never reaches the backend.
      throw new CodexAdapterError("Task was aborted before launch", "runtime_aborted", { details: { runtimeId: this.id } });
    }
    // P1-4: a backend without declared cancel may still execute; cancellation
    // capability is checked at cancel() time and reported typed instead.

    // Streaming wrapper: sanitize raw records once at the adapter boundary.
    // Async user-callback rejections are untracked in S2-3 (documented limitation):
    // the promise is caught defensively here so there is never an unhandled rejection;
    // typed callback failures for sync throws are owned by the backend delivery.
    const guardPromise = (value: unknown): void => {
      if (value instanceof Promise) value.catch(() => undefined);
    };
    const mappedCallbacks = {
      onEvent: (record: CodexNativeEvent) => {
        const outcome = callbacks.onEvent?.(normalizeEvent(record, this.id));
        guardPromise(outcome);                      // never an unhandled rejection
        return outcome;                             // backend may apply its own typed policy
      },
      onUsage: (usage: CodexNativeUsage, record: CodexNativeEvent) => {
        const outcome = callbacks.onUsage?.(toUsageMetrics(usage), normalizeEvent(record, this.id));
        guardPromise(outcome);
        return outcome;
      },
    };
    const backendTask: CodexBackendTask = {
      executionId: task.executionId,
      attempt: task.attempt,
      modelId: task.modelId,
      prompt: task.prompt,
      cwd: task.cwd,
      sessionId: task.sessionId,
      signal: task.signal,
      timeoutMs: task.timeoutMs,
    };

    let run;
    try {
      run = this.backend.execute(backendTask, mappedCallbacks);
    } catch (cause) {
      throw this.toAdapterError(cause); // backend refused synchronously (config) — nothing to clean up
    }
    const entry: ActiveRun = { executionId: task.executionId, cancel: () => this.backend.cancel(task.executionId) };
    this.active.set(task.executionId, entry);

    return run.completion
      .then((settled): RuntimeResult => this.toResult(settled))
      .catch((cause): never => { throw this.toAdapterError(cause); })
      .finally(() => { this.active.delete(task.executionId); });
  }

  /** Defensive cancel: unknown ids fail typed; a foreign runtime id is refused (no cross-runtime touches). */
  async cancel(handle: RuntimeExecutionHandle): Promise<void> {
    if (String(handle.runtimeId) !== this.id) {
      throw new CodexAdapterError(
        `Execution ${String(handle.executionId)} belongs to runtime ${String(handle.runtimeId)}`,
        "identifier_conflict",
        { details: { executionId: String(handle.executionId), ownerRuntimeId: String(handle.runtimeId) } },
      );
    }
    // P1-4: the capability gate comes BEFORE the active lookup — a backend
    // that never declared cancel must report typed unsupported for any cancel attempt.
    if (!this.capabilities().cancel || typeof this.backend.cancel !== "function") {
      // The backend never declared cancel: no guaranteed physical stop — typed refusal, never fake success.
      throw new CodexAdapterError(
        `Backend ${this.backend.kind} does not declare cancel: execution may keep running`,
        "unsupported_capability",
        { details: { backendKind: this.backend.kind, executionId: handle.executionId } },
      );
    }
    const entry = this.active.get(handle.executionId);
    if (!entry) {
      throw new CodexAdapterError(`No active execution for ${handle.executionId}`, "runtime_protocol");
    }
    entry.cancel();
  }

  /** Session resume requires a verified capability; S2-3 keeps it undeclared → typed refusal. */
  async resume(session: RuntimeSessionReference, task: RuntimeTask, callbacks: RuntimeExecutionCallbacks = {}): Promise<RuntimeResult> {
    if (!this.capabilities().sessionResume) {
      throw new CodexAdapterError(
        "Codex session resume is not supported in S2-3: production CLI session continuity is unverified",
        "unsupported_capability",
        { details: { requestedRuntimeId: String(session?.runtimeId ?? "") } },
      );
    }
    return this.execute({ ...task, sessionId: session.externalSessionId }, callbacks);
  }

  /** Maps a settled backend execution to the unified result (usage arrives aggregated). */
  private toResult(settled: {
    externalSessionId?: string;
    text: string;
    records: readonly CodexNativeEvent[];
    exitCode?: number;
    reason?: string;
    usage: CodexNativeUsage;
  }): RuntimeResult {
    return Object.freeze({
      runtimeId: this.id,
      externalSessionId: settled.externalSessionId,
      text: settled.text,
      events: Object.freeze(settled.records.map((record) => normalizeEvent(record, this.id))),
      exitCode: settled.exitCode,
      reason: settled.reason,
      usage: toUsageMetrics(settled.usage),
    });
  }

  private toAdapterError(cause: unknown): CodexAdapterError {
    if (cause instanceof CodexAdapterError) return cause;
    if (cause instanceof CodexBackendFailure) {
      const code = codeFromFailureKind(cause.kind);
      return new CodexAdapterError(cause.message, code, {
        retryable: RETRYABLE_CODES.includes(code),
        details: { backendKind: this.backend.kind },
        cause,
      });
    }
    const message = cause instanceof Error ? cause.message : "Unknown codex backend failure";
    return new CodexAdapterError(message, "runtime_failed", {
      retryable: false,
      details: cause instanceof Error ? { errorName: cause.name } : undefined,
      cause,
    });
  }
}

export function createCodexRuntimeAdapter(options: CodexRuntimeAdapterOptions): CodexRuntimeAdapter {
  return new CodexRuntimeAdapter(options);
}
