import type { RuntimeCapabilities } from "@open-agent-office/shared";
import {
  CodexBackendFailure,
  type CodexBackend,
  type CodexBackendCallbacks,
  type CodexBackendRun,
  type CodexBackendTask,
  type CodexFailureKind,
  type CodexNativeEvent,
  type CodexNativeUsage,
} from "./backend.js";

/**
 * Deterministic fake transport for the Codex adapter (S2-3 test fixture).
 * Never production: it exists so the adapter contract, the re-usable S2-1
 * conformance suite and the RuntimeManager integration are verifiable without
 * the Codex CLI, network, authorization or real LLM limits.
 *
 * The fake speaks a "transcript record" dialect (JSON-ish events with optional
 * `tokens`/`cost` payloads) and reports usage deltas through the same
 * callbacks a real backend would use. Tests drive executions slot-by-slot:
 * `createSlot()` reserves an index, `adapter.execute` fills it, and the slot
 * driver (`fill`/`failSlot`/`completeSlot`) settles it.
 */

export interface FakeCodexBackendOptions {
  /** Model coverage declared by this fake (`"*"` is a fixture knob, never a production claim). */
  readonly models?: readonly string[] | "*";
  readonly providers?: readonly string[];
  /** Fixture knobs to simulate honest capability gaps of a backend. */
  readonly cancelSupported?: boolean;
  readonly usageSupported?: boolean;
  /**
   * When true (default) every execute() gets an implicit driver slot;
   * when false only `createSlot()`-reserved executions may run (driver style).
   */
  readonly autoSlots?: boolean;
}

interface SlotController {
  readonly executionId: string;
  readonly feed: (record: CodexNativeEvent) => void;
  readonly fail: (kind: CodexFailureKind, message: string) => void;
  readonly complete: (settled: { externalSessionId?: string; exitCode?: number; reason?: string }) => void;
  readonly abort: () => void;
}

interface FakeSettled {
  readonly externalSessionId?: string;
  readonly exitCode?: number;
  readonly reason?: string;
  readonly records: readonly CodexNativeEvent[];
  readonly text: string;
  readonly usage: CodexNativeUsage;
}

export class FakeCodexBackend implements CodexBackend {
  readonly id = "codex-fake";
  readonly kind = "fake" as const;

  private readonly models: readonly string[] | "*";
  private readonly providers: readonly string[];
  private readonly cancelSupported: boolean;
  private readonly usageSupported: boolean;
  private readonly autoSlots: boolean;
  private readonly slots: (SlotController | undefined)[] = [];
  private readonly inflight = new Map<string, SlotController>();

  constructor(options: FakeCodexBackendOptions = {}) {
    this.models = options.models ?? "*";
    this.providers = options.providers ?? ["chatgpt-plus"];
    this.cancelSupported = options.cancelSupported ?? true;
    this.usageSupported = options.usageSupported ?? true;
    this.autoSlots = options.autoSlots ?? true;
  }

  capabilities(): RuntimeCapabilities {
    return {
      runtimeId: "codex",
      runtimeType: "codex",
      supportedProviders: Object.freeze([...this.providers]),
      supportedModels: this.models,
      session: true,
      // sessionResume stays undeclared: unknown for the production CLI (S2-3 honesty rule).
      cancel: this.cancelSupported,
      streamEvents: true,
      usage: this.usageSupported,
      notes: ["FAKE transport for S2-3; no Codex CLI, no network, no subscription usage"],
    };
  }

  execute(task: CodexBackendTask, callbacks: CodexBackendCallbacks): CodexBackendRun {
    if (this.inflight.has(task.executionId)) {
      throw new CodexBackendFailure("config", `backend already runs ${task.executionId}`);
    }
    let slotIndex = this.slots.findIndex((slot) => slot === undefined);
    if (slotIndex === -1) {
      if (!this.autoSlots) {
        // No reserved slot: fixtures with autoSlots=false drive every execution through createSlot().
        throw new CodexBackendFailure("config", `no reserved slot for execution ${task.executionId}`);
      }
      slotIndex = this.slots.push(undefined) - 1;
    }

    let resolved = false;
    let records: readonly CodexNativeEvent[] = [];
    let usage = emptyUsage();
    let resolveCompletion!: (value: FakeSettled) => void;
    let rejectCompletion!: (cause: CodexBackendFailure) => void;
    // The promise is created first so the settle helpers can always reject/resolve
    // (e.g. an invalid timeoutMs fails before the slot controller exists).
    const completion = new Promise<FakeSettled>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });

    // P1-1: resource cleanup on every settle path (timer + signal listener removal).
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const cleanupAfterSettle = (): void => {
      if (timer) { clearTimeout(timer); timer = undefined; }
      if (abortListener && task.signal) task.signal.removeEventListener("abort", abortListener);
      abortListener = undefined;
    };

    const settleFail = (kind: CodexFailureKind, message: string, cause?: unknown): void => {
      if (resolved) return;
      resolved = true;
      cleanupAfterSettle();
      rejectCompletion(new CodexBackendFailure(kind, message, { cause }));
    };
    const settleDone = (settled: { externalSessionId?: string; exitCode?: number; reason?: string }): void => {
      if (resolved) return;
      resolved = true;
      cleanupAfterSettle();
      resolveCompletion({
        externalSessionId: settled.externalSessionId,
        exitCode: settled.exitCode ?? 0,
        reason: settled.reason ?? "stop",
        records,
        text: records.map(textOf).join(""),
        usage,
      });
    };
    const deliver = (record: CodexNativeEvent): void => {
      if (resolved) return;
      records = [...records, record];
      const delta = usageDeltaOf(record);
      if (delta && this.usageSupported) {
        usage = addUsage(usage, delta);
        safe(() => callbacks.onUsage?.(delta, record), "onUsage");
      }
      safe(() => callbacks.onEvent?.(record), "onEvent");
    };
    // P2: sync callback throws → typed callback failure; async rejections of user
    // promises are caught here so they become typed when the execution is still in flight
    // and are swallowed silently after settle (never an unhandled rejection).
    const safe = (fn: () => unknown, what: string): void => {
      try {
        const outcome = fn() as unknown;
        if (outcome instanceof Promise) {
          outcome.catch((cause) => settleFail("callback", `${what} callback failed (async)`, cause));
        }
      } catch (cause) { settleFail("callback", `${what} callback failed`, cause); }
    };

    // P1-1: backend owns the timer and the signal relay (deterministic typed outcomes).
    if (typeof task.timeoutMs === "number") {
      if (!Number.isFinite(task.timeoutMs) || task.timeoutMs <= 0) {
        settleFail("config", "timeoutMs must be a positive finite number");
      } else if (!resolved) {
        timer = setTimeout(() => settleFail("timeout", `codex execution exceeded ${task.timeoutMs}ms`), task.timeoutMs);
      }
    }
    if (!resolved && task.signal) {
      if (task.signal.aborted) settleFail("abort", "codex execution was aborted");
      else {
        abortListener = () => settleFail("abort", "codex execution was aborted");
        task.signal.addEventListener("abort", abortListener, { once: true });
      }
    }

    const controller: SlotController = {
      executionId: task.executionId,
      feed: deliver,
      fail: (kind, message) => settleFail(kind, message),
      complete: (settled) => settleDone(settled),
      abort: () => settleFail("abort", "codex execution was aborted"),
    };
    this.slots[slotIndex] = controller;
    this.inflight.set(task.executionId, controller);

    return {
      executionId: task.executionId,
      completion: completion.finally(() => { this.inflight.delete(task.executionId); }),
    };
  }

  /** Aborts a backend execution; its completion resolves as `kind: "abort"`. */
  cancel(executionId: string): void {
    this.inflight.get(executionId)?.abort();
  }

  // ---- slot-driver surface (deterministic; mirrors the S2-1 conformance driver) ----

  /** Reserves the next driver slot index; `execute()` fills the first free slot. */
  createSlot(): number {
    this.slots.push(undefined);
    return this.slots.length - 1;
  }

  /** Feeds one transcript record into the reserved slot. */
  fill(index: number, record: CodexNativeEvent): void {
    this.slots[index]?.feed(record);
  }

  /** Fails the reserved slot with a typed backend failure kind. */
  failSlot(index: number, kind: CodexFailureKind, message = `fake failure (${kind})`): void {
    this.slots[index]?.fail(kind, message);
  }

  /** Completes the reserved slot like a natural process exit. */
  completeSlot(index: number, settled: { externalSessionId?: string; exitCode?: number; reason?: string } = {}): void {
    this.slots[index]?.complete({ externalSessionId: settled.externalSessionId, exitCode: settled.exitCode, reason: settled.reason });
  }

  /** Number of driver slots (implicit auto-slots included). */
  slotIndexCount(): number {
    return this.slots.length;
  }
}

/** Extracts a native usage delta from a transcript record that carries tokens/cost (fake dialect). */
function usageDeltaOf(record: CodexNativeEvent): CodexNativeUsage | undefined {
  const tokens = objectValue(record.tokens) ?? objectValue(objectValue(record.part)?.tokens) ?? objectValue(record.usage);
  if (!tokens) return undefined;
  const cache = objectValue(tokens.cache);
  const input = numberOr(tokens.input, 0);
  const output = numberOr(tokens.output, 0);
  const reasoning = numberOr(tokens.reasoning, 0);
  const cacheRead = numberOr(tokens.cacheRead ?? tokens.cache_read ?? cache?.read, 0);
  const cacheWrite = numberOr(tokens.cacheWrite ?? tokens.cache_write ?? cache?.write, 0);
  const declaredTotal = numberOr(tokens.total, NaN);
  const total = Number.isFinite(declaredTotal) ? declaredTotal : input + output + reasoning;
  const part = objectValue(record.part);
  return {
    input, output, reasoning, cacheRead, cacheWrite, total,
    cost: pickCost(record, part, tokens),
  };
}

function textOf(record: CodexNativeEvent): string {
  const part = objectValue(record.part);
  for (const candidate of [record.text, part?.text]) {
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

function addUsage(current: CodexNativeUsage, delta: CodexNativeUsage): CodexNativeUsage {
  return {
    input: current.input + delta.input,
    output: current.output + delta.output,
    reasoning: current.reasoning + delta.reasoning,
    cacheRead: current.cacheRead + delta.cacheRead,
    cacheWrite: current.cacheWrite + delta.cacheWrite,
    total: current.total + delta.total,
    cost: current.cost + delta.cost,
  };
}

function emptyUsage(): CodexNativeUsage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pickCost(record: CodexNativeEvent, part: Readonly<Record<string, unknown>> | undefined, tokens: Readonly<Record<string, unknown>>): number {
  const candidate = numberOr(record.cost, 0) || numberOr(part?.cost, 0) || numberOr(tokens.cost, 0);
  return candidate;
}
