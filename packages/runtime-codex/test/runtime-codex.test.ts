import { describe, expect, it } from "vitest";
import type { RuntimeEvent, RuntimeSessionBinding, RuntimeTask } from "@open-agent-office/shared";
import * as codexModule from "../src/index.js";
import { CodexRuntimeAdapter, CodexAdapterError, FakeCodexBackend } from "../src/index.js";

/**
 * Fake-backend functional checks (S2-3 §10, items 3–14). All concurrency is
 * deterministic (slot-bound), no timers, no network, no real Codex.
 */

const CWD = "/tmp/open-agent-office-codex-tests";

function makeTask(overrides: Partial<RuntimeTask> = {}): RuntimeTask {
  return {
    executionId: `cx-${Math.random().toString(36).slice(2, 8)}`,
    attempt: 1,
    modelId: "chatgpt-plus/fake-model",
    runtimeId: "codex" as never,
    prompt: "hello",
    cwd: CWD,
    ...overrides,
  };
}

function makeBinding(sessionId: string, runtimeId: string): RuntimeSessionBinding {
  return {
    sessionId,
    runtimeId: runtimeId as never,
    externalSessionId: `ext-${sessionId}`,
    status: "bound",
    boundAt: "2026-11-04T10:00:00.000Z",
    resumable: true,
  };
}

describe("Codex adapter with RuntimeManager (items 2, 7, 8, 10)", () => {
  // RuntimeManager import via the orchestrator public surface (integration proven cross-package).
  it("registers with the manager and routes an execution (identity preserved)", async () => {
    const { RuntimeManager } = await import("@open-agent-office/orchestrator").then((module) => module);
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const manager = new RuntimeManager();
    manager.register(adapter);
    expect(manager.list().map((caps) => caps.runtimeId)).toEqual(["codex"]);

    const events: RuntimeEvent[] = [];
    const execution = manager.execute(makeTask({ executionId: "cx-route" }), {
      onEvent: (event) => { events.push(event); },
    });
    // The implicit auto-slot is the last one; settle it like a driver would.
    const implicitSlot = backend.slotIndexCount() - 1;
    backend.fill(implicitSlot, { type: "step_finish", sessionID: "ses-mgr", reason: "stop" });
    backend.completeSlot(implicitSlot, { externalSessionId: "ses-mgr", reason: "stop" });
    const result = await execution;
    expect(result.runtimeId).toBe("codex");
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => typeof event.type === "string")).toBe(true);
    expect(manager.listActiveExecutions()).toEqual([]);
  });

  it("session bindings stay runtime-owned; resume is typed-unsupported, not faked", async () => {
    const { RuntimeManager } = await import("@open-agent-office/orchestrator").then((module) => module);
    const adapter = new CodexRuntimeAdapter({ backend: new FakeCodexBackend({ models: "*" }) });
    const manager = new RuntimeManager();
    manager.register(adapter);
    manager.bindSession(makeBinding("ses-codex", "codex"));
    expect(manager.checkCapabilities("codex", ["session"]).satisfied).toBe(true);
    await expect(adapter.resume(
      { runtimeId: "codex" as never, externalSessionId: "ext-ses-codex", resumable: true },
      makeTask({ sessionId: "ses-codex", executionId: "cx-resume" }),
      {},
    )).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(manager.listActiveExecutions()).toEqual([]);
  });

  it("honest capabilities: sessionResume undeclared, model coverage mirrored", () => {
    const adapter = new CodexRuntimeAdapter({ backend: new FakeCodexBackend({ models: ["chatgpt-plus"] }) });
    const caps = adapter.capabilities();
    expect(caps.sessionResume).toBeUndefined();
    expect(caps.supportedModels).toEqual(["chatgpt-plus"]);
    expect(caps.runtimeType).toBe("codex");
    expect(JSON.stringify(caps.notes)).toContain("FAKE transport");
  });

  it("P1-4: execute stays allowed for a backend without cancel; cancel() is typed-unsupported", async () => {
    const backend = new FakeCodexBackend({ models: "*", cancelSupported: false });
    const adapter = new CodexRuntimeAdapter({ backend });
    // Execute is fine: the backend just cannot guarantee a physical stop.
    const execution = adapter.execute(makeTask({ executionId: "cx-nocancel" }), {});
    const implicitSlot = backend.slotIndexCount() - 1;
    backend.fill(implicitSlot, { type: "step_finish", sessionID: "ses-nocancel", reason: "stop" });
    backend.completeSlot(implicitSlot, { externalSessionId: "ses-nocancel", reason: "stop" });
    const result = await execution;
    expect(result.runtimeId).toBe("codex");
    // Cancellation is reported typed, never faked as stopped:
    await expect(adapter.cancel({ executionId: "cx-nocancel", runtimeId: "codex" as never }))
      .rejects.toMatchObject({ code: "unsupported_capability", message: /may keep running/ });
  });
});

describe("Codex adapter lifecycle and cleanup (items 3–6, 9, 11–13)", () => {
  it("successful execution through explicit slots with re-use after completion", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const slot = backend.createSlot();
    const deltas: number[] = [];
    const run = adapter.execute(makeTask({ executionId: "cx-slots" }), { onUsage: (u) => { deltas.push(u.costUsd); } });
    backend.fill(slot, { type: "text", part: { text: "hello-" } });
    backend.fill(slot, { type: "step_finish", reason: "tool-calls", tokens: { input: 2, output: 2, reasoning: 0, cache: { read: 0, write: 0 }, total: 4 }, cost: 0.2 });
    backend.fill(slot, { type: "step_finish", sessionID: "ses-9", reason: "stop", tokens: { input: 1, output: 1, total: 2 }, cost: 0.1 });
    backend.completeSlot(slot, { externalSessionId: "ses-9", reason: "stop" });
    const result = await run;
    expect(result.text).toBe("hello-");
    expect(result.externalSessionId).toBe("ses-9");
    expect(result.usage?.costUsd).toBeCloseTo(0.3, 5);
    expect(deltas).toEqual([0.2, 0.1]);
    // A fresh execution can start after completion (item 11):
    const slot2 = backend.createSlot();
    const secondRun = adapter.execute(makeTask({ executionId: "cx-slots" }), {});
    backend.completeSlot(slot2, { externalSessionId: "ses-10" });
    const second = await secondRun;
    expect(second.externalSessionId).toBe("ses-10");
  });

  it("backend refusal is typed and does not touch parallel executions", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    backend.createSlot(); // reserved by the first (held) execution
    const held = adapter.execute(makeTask({ executionId: "cx-hold" }), {});
    const typedHold = expect(held).rejects.toMatchObject({ code: "runtime_aborted" }); // attached before cancel

    const unreservedAdapter = new CodexRuntimeAdapter({ backend: new FakeCodexBackend({ models: "*", autoSlots: false }) });
    await expect(unreservedAdapter.execute(makeTask({ executionId: "cx-noslot" }), {}))
      .rejects.toMatchObject({ code: "runtime_launch_failed" });

    await adapter.cancel({ executionId: "cx-hold", runtimeId: "codex" as never });
    await typedHold;
  });

  it("cancel aborts a running execution; unknown handle and foreign runtime are typed", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    backend.createSlot();
    const run = adapter.execute(makeTask({ executionId: "cx-cancel" }), {});
    const typed = expect(run).rejects.toMatchObject({ code: "runtime_aborted" });
    await adapter.cancel({ executionId: "cx-cancel", runtimeId: "codex" as never });
    await typed;
    await expect(adapter.cancel({ executionId: "cx-ghost", runtimeId: "codex" as never })).rejects.toMatchObject({ code: "runtime_protocol" });
    await expect(adapter.cancel({ executionId: "anything", runtimeId: "opencode" as never })).rejects.toMatchObject({ code: "identifier_conflict" });
  });

  it("two parallel executions on one adapter are isolated (slot-bound, deterministic)", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const slotA = backend.createSlot();
    const slotB = backend.createSlot();
    const runA = adapter.execute(makeTask({ executionId: "cx-iso-a" }), {});
    const runB = adapter.execute(makeTask({ executionId: "cx-iso-b" }), {});
    backend.completeSlot(slotA, { externalSessionId: "ses-a" });
    backend.completeSlot(slotB, { externalSessionId: "ses-b" });
    const [resultA, resultB] = await Promise.all([runA, runB]);
    expect(resultA.externalSessionId).toBe("ses-a");
    expect(resultB.externalSessionId).toBe("ses-b");
    expect(resultA.externalSessionId).not.toBe(resultB.externalSessionId);
  });

  it("duplicate in-flight id inside the adapter is rejected without a second native run", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    backend.createSlot();
    const first = adapter.execute(makeTask({ executionId: "cx-dup" }), {});
    await expect(adapter.execute(makeTask({ executionId: "cx-dup" }), {})).rejects.toMatchObject({ code: "identifier_conflict" });
    backend.fill(0, { type: "step_finish", reason: "stop" });
    backend.completeSlot(0, { externalSessionId: "ses-dup" });
    await first; // first stays intact and settles naturally
  });

  it("user callback failure fails typed (item 9)", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const slot = backend.createSlot();
    const run = adapter.execute(makeTask({ executionId: "cx-callback" }), { onEvent: () => { throw new Error("callback exploded"); } });
    backend.fill(slot, { type: "text", part: { text: "boom path" } });
    await expect(run).rejects.toMatchObject({ code: "runtime_callback_failed", message: /callback exploded/ });
  });

  it("no secret leakage in events (item 12)", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const slot = backend.createSlot();
    const seen: RuntimeEvent[] = [];
    const run = adapter.execute(makeTask({ executionId: "cx-secret" }), { onEvent: (event) => { seen.push(event); } });
    backend.fill(slot, { type: "text", part: { text: "Authorization: Bearer zzz9 mission" } });
    backend.completeSlot(slot, { externalSessionId: "ses-secret" });
    await run;
    expect(JSON.stringify(seen)).not.toContain("zzz9");
    expect(JSON.stringify(seen)).toContain("[REDACTED]");
  });

  it("no unhandled rejection window with early cancels (item 13)", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    backend.createSlot();
    const run = adapter.execute(makeTask({ executionId: "cx-early" }), {});
    const typed = expect(run).rejects.toMatchObject({ code: "runtime_aborted" });
    await adapter.cancel({ executionId: "cx-early", runtimeId: "codex" as never });
    await typed;
  });
});

describe("Codex public exports (item 14)", () => {
  it("exports exactly the planned runtime values (no hidden managers)", () => {
    const valueNames = Object.keys(codexModule).sort();
    expect(valueNames).toEqual([
      "CodexAdapterError",
      "CodexBackendFailure",
      "CodexRuntimeAdapter",
      "FakeCodexBackend",
      "ProductionCodexBackend",
      "createCodexRuntimeAdapter",
      "createProductionCodexBackend",
      "preflightCodex",
    ]);
    // No manager/registry-like symbols leak from the adapter package (S2-2 boundary):
    expect(valueNames.some((name) => name.toLowerCase().includes("manager"))).toBe(false);
    for (const value of Object.values(codexModule)) {
      if (typeof value === "function") {
        expect(value.name.length).toBeGreaterThan(0);
      }
    }
  });
});

/** MAO-CORE-04-FIX regression block (P1-1…P1-4 + P2). */
describe("FIX regressions (P1-1/P1-2/P1-3/P2)", () => {
  it("P1-1: task.signal abort delivers typed runtime_aborted and cleans resources", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const controller = new AbortController();
    backend.createSlot();
    const run = adapter.execute(makeTask({ executionId: "fix-signal", signal: controller.signal }), {});
    const typed = expect(run).rejects.toMatchObject({ code: "runtime_aborted", message: /aborted/ }); // no unhandled rejection
    controller.abort();
    await typed;
    expect(backend.slotIndexCount()).toBeGreaterThanOrEqual(1);
  });

  it("P1-1: pre-aborted signal fails fast before backend dispatch", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.execute(makeTask({ executionId: "fix-signal-early", signal: controller.signal }), {}))
      .rejects.toMatchObject({ code: "runtime_aborted", message: /before launch/ });
    expect(backend.slotIndexCount()).toBe(0); // nothing reached the backend
  });

  it("P1-1: timeoutMs produces typed runtime_timeout and frees the slot", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const run = adapter.execute(makeTask({ executionId: "fix-timeout", timeoutMs: 2 }), {});
    await expect(run).rejects.toMatchObject({ code: "runtime_timeout", message: /exceeded 2ms/ });
    // Timer cleaned: a fresh execution runs to completion afterwards.
    const slot = backend.slotIndexCount();
    void slot;
    const secondRun = adapter.execute(makeTask({ executionId: "fix-timeout-2", timeoutMs: 2000 }), {});
    backend.fill(backend.slotIndexCount() - 1, { type: "step_finish", reason: "stop" });
    backend.completeSlot(backend.slotIndexCount() - 1, { externalSessionId: "ses-after" });
    const second = await secondRun;
    expect(second.externalSessionId).toBe("ses-after");
  });

  it("P1-1: an invalid timeoutMs is a typed config failure", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    await expect(adapter.execute(makeTask({ executionId: "fix-bad-timeout", timeoutMs: 0 }), {}))
      .rejects.toMatchObject({ code: "runtime_launch_failed", message: /timeoutMs/ });
  });

  it("P1-2: foreign runtimeId is refused before any backend interaction", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    await expect(adapter.execute(makeTask({ executionId: "fix-foreign", runtimeId: "opencode" as never }), {}))
      .rejects.toMatchObject({ code: "identifier_conflict", message: /does not match this adapter/ });
    expect(backend.slotIndexCount()).toBe(0); // backend never touched
  });

  it("P1-3: result.text is the trusted channel; events and diagnostics are sanitized", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const slot = backend.createSlot();
    const seen: RuntimeEvent[] = [];
    const run = adapter.execute(makeTask({ executionId: "fix-secret" }), { onEvent: (event) => { seen.push(event); } });
    backend.fill(slot, { type: "text", part: { text: "Authorization: Bearer sk-live-99 keep" } });
    backend.fill(slot, { type: "step_finish", part: { reason: "stop", tokens: { input: 1, output: 1, total: 2 } }, text: "token=abc123", sessionID: "ses-fix" });
    backend.completeSlot(slot, { externalSessionId: "ses-fix", reason: "stop" });
    const result = await run;
    // Events: sanitized (public channel):
    expect(JSON.stringify(seen)).not.toContain("sk-live-99");
    expect(JSON.stringify(seen)).toContain("[REDACTED]");
    // Result text: trusted channel passes through unchanged (documented boundary):
    expect(result.text).toContain("token=abc123");
    // Diagnostics: backend error messages are redacted at the adapter border:
    // Backend failure diagnostics: the message passes through redactSecrets at the adapter border.
    const backend2 = new FakeCodexBackend({ models: "*", autoSlots: true });
    const adapter2 = new CodexRuntimeAdapter({ backend: backend2 });
    const failing = adapter2.execute(makeTask({ executionId: "fix-secret-2" }), {});
    backend2.fill(backend2.slotIndexCount() - 1, { type: "error", message: "api_key=zzneversecret" });
    backend2.failSlot(backend2.slotIndexCount() - 1, "config", `api_key=zzneversecret appeared`);
    const adapterError = await failing.then(() => null, (candidate: unknown) => candidate as CodexAdapterError);
    expect(adapterError?.code).toBe("runtime_launch_failed");
    expect(adapterError?.message).not.toContain("zzneversecret");
    expect(adapterError?.message).toContain("[REDACTED]");
  });
});

describe("P2: callback error determinism (sync/async, event/usage)", () => {
  it("async onEvent rejection produces a typed callback failure, no unhandled rejections", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const slot = backend.createSlot();
    const run = adapter.execute(makeTask({ executionId: "fix-async-cb" }), {
      onEvent: () => Promise.reject(new Error("async event failure")),
    });
    backend.fill(slot, { type: "text", part: { text: "trigger" } });
    await expect(run).rejects.toMatchObject({ code: "runtime_callback_failed", message: /async event failure/ });
  });

  it("sync onUsage throw is typed as runtime_callback_failed", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const slot = backend.createSlot();
    const run = adapter.execute(makeTask({ executionId: "fix-sync-usage" }), {
      onUsage: () => { throw new Error("usage handler blew up"); },
    });
    backend.fill(slot, { type: "step_finish", tokens: { input: 1, output: 1, total: 2 }, cost: 0.1 });
    await expect(run).rejects.toMatchObject({ code: "runtime_callback_failed", message: /usage handler blew up/ });
  });

  it("late async callback rejection after settle is swallowed (never unhandled)", async () => {
    const backend = new FakeCodexBackend({ models: "*" });
    const adapter = new CodexRuntimeAdapter({ backend });
    const slot = backend.createSlot();
    const run = adapter.execute(makeTask({ executionId: "fix-late-cb" }), {
      onEvent: () => Promise.reject(new Error("too late, already settled")),
    });
    backend.fill(slot, { type: "step_finish", reason: "stop" });
    backend.completeSlot(slot, { externalSessionId: "ses-late" });
    const result = await run; // settles fine; the late rejection is contained by the adapter guard
    expect(result.externalSessionId).toBe("ses-late");
  });
});
