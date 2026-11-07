import { type EntityId, type ProviderId, type RuntimeId, type Timestamp } from "./common.js";
import type { RuntimeSessionBinding } from "./sessions.js";
import type { UsageMetrics } from "./usage.js";
/**
 * Runtime contracts shared by OpenCode (C15) and Codex (C18) adapters
 * (ADR-MAO-010, API_CONTRACTS §2.16). Types and the declarative adapter
 * contract only — the first RuntimeAdapter implementation is wave S2-1.
 *
 * Rule: nothing here assumes parity of capabilities — every behaviour
 * beyond "run → result / typed error" is an explicitly declared capability.
 */
/** Runtime kinds shipped with MAO; kept extensible for future adapters. */
export type RuntimeType = "opencode" | "codex" | (string & {});
export type RuntimeStatus = "available" | "unavailable" | "disabled";
/** Declared capabilities of one adapter. Optional fields mean "may be absent". */
export interface RuntimeCapabilities {
    readonly runtimeId: RuntimeId;
    readonly runtimeType: RuntimeType;
    readonly supportedProviders: readonly ProviderId[];
    /** Model id prefixes accepted by the adapter; `"*"` = everything in the catalog. */
    readonly supportedModels: readonly string[] | "*";
    readonly session: boolean;
    /** Session restore across restarts; never assumed, only declared. */
    readonly sessionResume?: boolean;
    readonly cancel?: boolean;
    readonly streamEvents?: boolean;
    readonly usage?: boolean;
    /** Adapter-level concurrency ceiling (input for C20). */
    readonly maxAdapterConcurrency?: number;
    readonly notes?: readonly string[];
}
/** Human-facing registry entry of an adapter (real or fake). */
export interface RuntimeDescriptor {
    readonly id: RuntimeId;
    readonly displayName: string;
    /** Source package, e.g. `runtime-opencode` / `runtime-codex`. */
    readonly package: string;
    readonly capabilities: RuntimeCapabilities;
    readonly status: RuntimeStatus;
}
/** Uniform execution request handed to an adapter (only through C17). */
export interface RuntimeTask {
    readonly executionId: EntityId;
    /** 1-based retry attempt (`1` = first run). */
    readonly attempt: number;
    readonly modelId: string;
    readonly runtimeId: RuntimeId;
    readonly prompt: string;
    /** Absolute working directory of the execution (project-scoped). */
    readonly cwd: string;
    readonly title?: string;
    /** Prior adapter conversation to continue (only if `session` is declared). */
    readonly sessionId?: string;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
}
/** Alias used in the API contracts table (API_CONTRACTS §2.16). */
export type RuntimeExecutionRequest = RuntimeTask;
/** Uniform result of a successful execution. */
export interface RuntimeResult {
    readonly runtimeId: RuntimeId;
    readonly externalSessionId?: string;
    readonly text: string;
    readonly events: readonly RuntimeEvent[];
    readonly exitCode?: number;
    /** Adapter-specific stop reason (e.g. `stop`, `tool-calls`). */
    readonly reason?: string;
    readonly usage?: UsageMetrics;
}
/** Alias used in the API contracts table (API_CONTRACTS §2.16). */
export type RuntimeExecutionResult = RuntimeResult;
/** Cross-runtime event taxonomy; native adapter events are normalized to this. */
export type RuntimeEventType = "message.delta" | "message" | "tool.started" | "tool.finished" | "usage" | "state.changed" | "error" | "custom" | (string & {});
export interface RuntimeEvent {
    readonly type: RuntimeEventType;
    readonly occurredAt?: Timestamp;
    readonly payload: Readonly<Record<string, unknown>>;
    /** Adapter that produced the event (filled by C17 when absent). */
    readonly runtimeId?: RuntimeId;
}
/** Adapter-side conversation pointer, separate from MAO session identity. */
export interface RuntimeSessionReference {
    readonly runtimeId: RuntimeId;
    readonly externalSessionId: string;
    /** Whether the adapter currently can resume this session. */
    readonly resumable: boolean;
}
/** Opaque handle produced by an adapter for a running execution. */
export interface RuntimeExecutionHandle {
    readonly executionId: EntityId;
    readonly runtimeId: RuntimeId;
}
/** Typed runtime error codes of the unified error surface (API_CONTRACTS §2.16). */
export type RuntimeErrorCode = "runtime_launch_failed" | "runtime_timeout" | "runtime_aborted" | "runtime_protocol" | "runtime_model_rejected" | "runtime_exit_nonzero" | "runtime_incomplete" | "runtime_callback_failed"
/** Deterministic fallback for an unrecognized native failure; never fakes success (S2-2 alignment). */
 | "runtime_failed" | (string & {});
/** Capability checks requested against one adapter (no invented capabilities). */
export type RuntimeRequirement = "session" | "sessionResume" | "cancel" | "streamEvents" | "usage";
/** Result of {@link RuntimeManager.checkCapabilities}. */
export interface RuntimeCapabilityReport {
    readonly runtimeId: RuntimeId;
    /** True only when every requested requirement is declared by the adapter. */
    readonly satisfied: boolean;
    /** Requirements that were requested but not declared. */
    readonly missing: readonly RuntimeRequirement[];
}
/** Deterministic manager contract (API_CONTRACTS §2.17); implementation lives in orchestrator (C17). */
export interface RuntimeManagerContract {
    register(adapter: RuntimeAdapter): void;
    list(): readonly RuntimeCapabilities[];
    get(runtimeId: RuntimeId): RuntimeAdapter;
    /** Picks a registered adapter whose declared model support covers `modelId`. */
    resolveFor(modelId: string, requireAll?: readonly RuntimeRequirement[]): RuntimeAdapter;
    execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks): Promise<RuntimeResult>;
    /** Duplicate in-flight execution ids are rejected (`identifier_conflict`), not overwritten. */
    cancel(handle: RuntimeExecutionHandle): Promise<void>;
    listActiveExecutions(): readonly RuntimeExecutionHandle[];
    checkCapabilities(runtimeId: RuntimeId, requirements: readonly RuntimeRequirement[]): RuntimeCapabilityReport;
    /** Records an adapter-side session bound to one runtime. */
    bindSession(binding: RuntimeSessionBinding): void;
    /** Resumes a session strictly through its owning runtime; cross-runtime attempts are refused. */
    resumeSession(sessionId: EntityId, task: RuntimeTask, callbacks: RuntimeExecutionCallbacks): Promise<RuntimeResult>;
}
/** Unified runtime failure shape; concrete classes stay adapter-local. */
export interface RuntimeError {
    readonly code: RuntimeErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly cause?: unknown;
}
/** Streaming callbacks provided by C17 (usage deltas precede their event). */
export interface RuntimeExecutionCallbacks {
    readonly onEvent?: (event: RuntimeEvent) => void;
    readonly onUsage?: (usage: UsageMetrics, event: RuntimeEvent) => void;
}
/**
 * Declarative adapter contract (API_CONTRACTS §2.16). Implementations start
 * in wave S2-1 (C15 wrapper) and S2-3 (C18) — this file intentionally
 * contains no implementation.
 */
export interface RuntimeAdapter {
    readonly id: RuntimeId;
    capabilities(): RuntimeCapabilities;
    execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks): Promise<RuntimeResult>;
    /** Present only when `capabilities().cancel` is true. */
    cancel?(handle: RuntimeExecutionHandle): Promise<void>;
    /** Present only when `capabilities().sessionResume` is true. */
    resume?(session: RuntimeSessionReference, task: RuntimeTask, callbacks: RuntimeExecutionCallbacks): Promise<RuntimeResult>;
}
