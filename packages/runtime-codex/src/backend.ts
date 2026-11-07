import type { RuntimeCapabilities } from "@open-agent-office/shared";

/**
 * Transport boundary for the Codex Runtime adapter (S2-3, ADR-MAO-010/012).
 * The adapter never talks to the Codex CLI directly; a backend owns launch,
 * native event parsing, session continuity and authorization.
 *
 * Wave S2-3 constraints:
 * - no real Codex CLI here; no unofficial ChatGPT authorization paths;
 * - no invented Codex protocol: whatever format the future production
 *   backend supports stays inside the backend boundary and is a deferred
 *   compatibility gate (ADR-MAO-012);
 * - `FakeCodexBackend` is a deterministic test/emulation fixture, never a
 *   claim of production readiness.
 */

/** Native usage delta in the backend dialect; the adapter maps `cost` → canonical `costUsd`. */
export interface CodexNativeUsage {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
  readonly cost: number;
}

/** Raw backend-internal event record; only the backend knows its real shape. */
export type CodexNativeEvent = Readonly<Record<string, unknown>>;

/** Task subset an adapter hands to its backend (no runtime-foreign fields). */
export interface CodexBackendTask {
  readonly executionId: string;
  readonly attempt: number;
  readonly modelId: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly sessionId?: string;
  /** Passed through so the backend can guarantee physical stop (typed abort). */
  readonly signal?: AbortSignal;
  /** Enforced by the backend (adapter has no timer of its own) → typed timeout. */
  readonly timeoutMs?: number;
}

/** Failure classification reported by a backend. */
export type CodexFailureKind = "config" | "model" | "exit" | "abort" | "callback" | "timeout" | "protocol" | "unknown";

export class CodexBackendFailure extends Error {
  readonly kind: CodexFailureKind;

  constructor(kind: CodexFailureKind, message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.kind = kind;
    this.cause = options.cause;
  }
}

export interface CodexBackendRun {
  readonly executionId: string;
  /**
   * Resolves when the backend-executed task settles. Streaming stays inside
   * the callbacks; user-callback throws are mapped to `kind: "callback"`
   * failures by the backend (never propagated to the CLI process).
   */
  readonly completion: Promise<{
    readonly externalSessionId?: string;
    readonly text: string;
    readonly records: readonly CodexNativeEvent[];
    readonly exitCode?: number;
    readonly reason?: string;
    readonly usage: CodexNativeUsage;
  }>;
}

export interface CodexBackendCallbacks {
  readonly onEvent?: (record: CodexNativeEvent) => void;
  readonly onUsage?: (usage: CodexNativeUsage, record: CodexNativeEvent) => void;
}

export interface CodexBackend {
  /** Marker for honest diagnostics (`fake` fixtures never pose as production). */
  readonly kind: "fake" | "real";
  readonly id: string;
  /** Declared model/provider coverage of THIS backend; the adapter mirrors it. */
  capabilities(): RuntimeCapabilities;
  /** Starts one execution; the adapter owns retry semantics outwards. */
  execute(task: CodexBackendTask, callbacks: CodexBackendCallbacks): CodexBackendRun;
  /** Aborts a backend execution; the backend resolves it as `kind: "abort"`. */
  cancel(executionId: string): void;
}

export type CodexBackendFactory = () => CodexBackend;
