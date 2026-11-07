import { describe, expect, it, vi } from "vitest";
import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeExecutionCallbacks,
  RuntimeResult,
  RuntimeSessionBinding,
  RuntimeTask,
} from "@open-agent-office/shared";
import { RuntimeManager, RuntimeManagerError, supportsModel } from "../src/runtime-manager.js";

/**
 * Wave S2-2 conformance for C17. All runtimes are fake adapters; no real
 * CLI, no real LLM, no network.
 */

const CWD = "/tmp/open-agent-office-runtime-manager-test";

function makeTask(runtimeId: string, overrides: Partial<RuntimeTask> = {}): RuntimeTask {
  return {
    executionId: `tx-${Math.random().toString(36).slice(2, 8)}`,
    attempt: 1,
    modelId: "opencode-go/glm-5.3-flash",
    runtimeId: runtimeId as never,
    prompt: "hello",
    cwd: CWD,
    ...overrides,
  };
}

function makeBinding(sessionId: string, runtimeId: string, overrides: Partial<RuntimeSessionBinding> = {}): RuntimeSessionBinding {
  return {
    sessionId,
    runtimeId: runtimeId as never,
    externalSessionId: `ext-${sessionId}`,
    status: "bound",
    boundAt: "2026-11-04T10:00:00.000Z",
    resumable: true,
    ...overrides,
  };
}

/** Programmable fake adapter with sanitized identity contract. */
class FakeAdapter implements RuntimeAdapter {
  readonly id: string;
  private readonly caps: RuntimeCapabilities;
  readonly executeCalls: { task: RuntimeTask; runtimeId: string }[] = [];
  readonly resumeCalls: { externalSessionId: string; runtimeId: string }[] = [];
  readonly cancelCalls: string[] = [];
  /** Test switch: next execute() will reject with this code. */
  failNext?: { code: string; message: string };
  /** Test switch: next execute() never settles (keeps the active-registry entry). */
  holdNext = false;
  /** Test switch: every execute() stays in flight (deterministic concurrency tests). */
  holdAll = false;
  /** Test switch: next execute() throws from a user callback. */
  callbackThrowNext = false;
  private readonly heldRejects = new Map<string, (error: Error) => void>();

  constructor(id: string, caps: Partial<RuntimeCapabilities> = {}) {
    this.id = id;
    this.caps = {
      runtimeId: id as never,
      runtimeType: id,
      supportedProviders: [id === "opencode" ? "opencode-go" : "fake-provider"],
      supportedModels: "*",
      session: true,
      sessionResume: true,
      cancel: true,
      streamEvents: true,
      usage: true,
      ...caps,
    };
  }

  capabilities(): RuntimeCapabilities {
    return { ...this.caps };
  }

  async execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks = {}): Promise<RuntimeResult> {
    if (this.holdAll || this.holdNext) {
      this.holdNext = false;
      // Held in flight until cancelled in the test; cancel resolves it typed.
      return new Promise<RuntimeResult>((_resolve, reject) => { this.heldRejects.set(task.executionId, reject); });
    }
    if (this.callbackThrowNext) {
      this.callbackThrowNext = false;
      callbacks.onEvent?.({ type: "state.changed", payload: {} });
    }
    if (this.failNext) {
      const failure = this.failNext;
      this.failNext = undefined;
      throw Object.assign(new Error(failure.message), { code: failure.code, retryable: false });
    }
    this.executeCalls.push({ task, runtimeId: String(task.runtimeId) });
    callbacks.onEvent?.({ type: "state.changed", payload: { ok: true }, runtimeId: task.runtimeId });
    callbacks.onUsage?.({ input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2, costUsd: 0.1 }, { type: "usage", payload: {} });
    return Object.freeze({
      runtimeId: task.runtimeId,
      externalSessionId: `ext-${task.executionId}`,
      text: `ok-${task.executionId}`,
      events: [] as never,
      exitCode: 0,
      reason: "stop",
      usage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2, costUsd: 0.1 },
    });
  }

  async cancel(handle: { executionId: string; runtimeId: string }): Promise<void> {
    this.cancelCalls.push(handle.executionId);
    const reject = this.heldRejects.get(handle.executionId);
    if (reject) {
      this.heldRejects.delete(handle.executionId);
      reject(Object.assign(new Error(`${handle.executionId} was aborted`), { code: "runtime_aborted", retryable: false }));
    }
  }

  async resume(session: { externalSessionId: string }, task: RuntimeTask, callbacks: RuntimeExecutionCallbacks = {}): Promise<RuntimeResult> {
    this.resumeCalls.push({ externalSessionId: session.externalSessionId, runtimeId: String(task.runtimeId) });
    return this.execute({ ...task }, callbacks);
  }
}

// 1. OpenCode adapter registration (real public surface, no execution).
describe("RuntimeManager registration", () => {
  it("1. registers the real OpenCode adapter by its RuntimeId", async () => {
    const { OpenCodeRuntimeAdapter } = await import("@open-agent-office/runtime-opencode");
    const manager = new RuntimeManager();
    manager.register(new OpenCodeRuntimeAdapter() as never satisfies RuntimeAdapter);
    expect(manager.list()).toHaveLength(1);
    expect(String(manager.get("opencode").id)).toBe("opencode");
    expect(manager.checkCapabilities("opencode", ["session", "cancel", "streamEvents", "usage"]).satisfied).toBe(true);
  });

  it("2. registers a second, distinct fake runtime and 3. lists both", () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode"));
    manager.register(new FakeAdapter("codex"));
    expect(manager.list().map((caps) => caps.runtimeId)).toEqual(["opencode", "codex"]);
  });

  it("4. rejects duplicate RuntimeId instead of silently replacing", () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode"));
    expect(() => manager.register(new FakeAdapter("opencode"))).toThrowError(RuntimeManagerError);
    try {
      manager.register(new FakeAdapter("opencode"));
    } catch (error) {
      expect((error as RuntimeManagerError).code).toBe("identifier_conflict");
    }
    expect(manager.list()).toHaveLength(1);
  });

  it("supportsModel matches prefixes correctly", () => {
    expect(supportsModel({ ...new FakeAdapter("opencode").capabilities(), supportedModels: ["opencode-go"] }, "opencode-go/glm")).toBe(true);
    expect(supportsModel({ ...new FakeAdapter("opencode").capabilities(), supportedModels: ["opencode-go"] }, "chatgpt-plus/gpt")).toBe(false);
  });
});

describe("RuntimeManager capabilities and dispatch", () => {
  it("5. returns capabilities of a concrete runtime", () => {
    const manager = new RuntimeManager();
    const adapter = new FakeAdapter("opencode", { cancel: false });
    manager.register(adapter);
    expect(manager.get("opencode").capabilities().cancel).toBe(false);
    const report = manager.checkCapabilities("opencode", ["session", "usage"]);
    expect(report.satisfied).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it("6. resolves adapters deterministically by declared model coverage", () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode", { supportedModels: ["opencode-go"] }));
    manager.register(new FakeAdapter("codex", { supportedModels: ["chatgpt-plus"] }));
    expect(manager.resolveFor("opencode-go/glm-5.3-flash").id).toBe("opencode");
    expect(manager.resolveFor("chatgpt-plus/gpt").id).toBe("codex");
  });

  it("7. rejects dispatch when the runtime is not registered", async () => {
    const manager = new RuntimeManager();
    await expect(manager.execute(makeTask("ghost"), {})).rejects.toMatchObject({ code: "not_found" });
    expect(() => manager.get("ghost" as never)).toThrowError(RuntimeManagerError);
  });

  it("8. refuses dispatch before start when a required capability is absent", async () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode", { usage: false }));
    const report = manager.checkCapabilities("opencode", ["usage"]);
    expect(report.satisfied).toBe(false);
    expect(report.missing).toEqual(["usage"]);
    // Capability-based pick also refuses before any adapter call:
    expect(() => manager.resolveFor("opencode-go/glm-5.3-flash", ["usage"])).toThrowError(RuntimeManagerError);
    try {
      manager.resolveFor("opencode-go/glm-5.3-flash", ["usage"]);
    } catch (error) {
      expect((error as RuntimeManagerError).code).toBe("unsupported_capability");
    }
  });

  it("9. routes an execution and (10) surfaces adapter failures typed", async () => {
    const manager = new RuntimeManager();
    const adapter = new FakeAdapter("opencode");
    manager.register(adapter);
    const task = makeTask("opencode", { executionId: "tx-route" });
    const deltas: number[] = [];
    const result = await manager.execute(task, { onUsage: (usage) => { deltas.push(usage.costUsd); } });
    expect(adapter.executeCalls).toHaveLength(1);
    expect(adapter.executeCalls[0].runtimeId).toBe("opencode");
    expect(result.text).toBe("ok-tx-route");
    expect(deltas).toEqual([0.1]);

    const failing = new FakeAdapter("codex");
    manager.register(failing);
    failing.failNext = { code: "runtime_model_rejected", message: "model crowded" };
    await expect(manager.execute(makeTask("codex", { modelId: "chatgpt-plus/gpt", executionId: "cx-1" }), {}))
      .rejects.toMatchObject({ code: "runtime_model_rejected", message: "model crowded" });
  });

  it("11. cancels a running execution through its owning runtime (typed abort, no unhandled rejection)", async () => {
    const manager = new RuntimeManager();
    const adapter = new FakeAdapter("opencode");
    adapter.holdNext = true; // keep the execution in flight until cancelled
    manager.register(adapter);
    const execution = manager.execute(makeTask("opencode", { executionId: "tx-cancel" }), {});
    const typed = expect(execution).rejects.toMatchObject({ code: "runtime_aborted", message: /tx-cancel was aborted/ });
    await manager.cancel({ executionId: "tx-cancel", runtimeId: "opencode" as never });
    expect(adapter.cancelCalls).toEqual(["tx-cancel"]);
    await typed;
    expect(manager.listActiveExecutions()).toEqual([]); // cancelled execution leaves the registry
  });

  it("12. rejects cancelling an unknown handle", async () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode"));
    await expect(manager.cancel({ executionId: "nope", runtimeId: "opencode" as never })).rejects.toMatchObject({ code: "not_found" });
  });

  it("13. isolates execution registers across runtimes (cross-runtime cancel refused)", async () => {
    const manager = new RuntimeManager();
    const opencode = new FakeAdapter("opencode");
    const codex = new FakeAdapter("codex");
    opencode.holdNext = true;
    codex.holdNext = true;
    manager.register(opencode);
    manager.register(codex);
    const first = manager.execute(makeTask("opencode", { executionId: "tx-iso-1" }), {});
    const second = manager.execute(makeTask("codex", { executionId: "tx-iso-2" }), {});
    // Both rejections are attached BEFORE cancellation: no unhandled rejections occur.
    const typedFirst = expect(first).rejects.toMatchObject({ code: "runtime_aborted" });
    const typedSecond = expect(second).rejects.toMatchObject({ code: "runtime_aborted" });
    expect(manager.listActiveExecutions().map((handle) => handle.executionId)).toEqual(["tx-iso-1", "tx-iso-2"]);
    // A cancel addressed to the wrong runtime is refused without touching the owner:
    await expect(manager.cancel({ executionId: "tx-iso-1", runtimeId: "codex" as never })).rejects.toMatchObject({ code: "identifier_conflict" });
    expect(opencode.cancelCalls).toHaveLength(0);
    expect(codex.cancelCalls).toHaveLength(0);
    expect(manager.listActiveExecutions().map((handle) => handle.executionId).sort()).toEqual(["tx-iso-1", "tx-iso-2"]);
    await manager.cancel({ executionId: "tx-iso-1", runtimeId: "opencode" as never });
    expect(opencode.cancelCalls).toEqual(["tx-iso-1"]);
    expect(codex.cancelCalls).toHaveLength(0);
    // Finish the remaining sibling so every held execution settles deterministically.
    await manager.cancel({ executionId: "tx-iso-2", runtimeId: "codex" as never });
    expect(codex.cancelCalls).toEqual(["tx-iso-2"]);
    await Promise.all([typedFirst, typedSecond]);
    expect(manager.listActiveExecutions()).toEqual([]);
  });

  it("14. binds sessions to their owning runtime", () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode"));
    manager.register(new FakeAdapter("codex"));
    manager.bindSession(makeBinding("ses-1", "opencode"));
    manager.bindSession(makeBinding("ses-2", "codex"));
    expect(manager.checkCapabilities("opencode", ["session"]).satisfied).toBe(true);
  });

  it("15. refuses resuming a session through a foreign runtime (before any adapter call)", async () => {
    const manager = new RuntimeManager();
    const opencode = new FakeAdapter("opencode");
    const codex = new FakeAdapter("codex");
    manager.register(opencode);
    manager.register(codex);
    manager.bindSession(makeBinding("ses-owned", "opencode"));
    await expect(manager.resumeSession("ses-owned" as never, makeTask("codex"), {}))
      .rejects.toMatchObject({ code: "identifier_conflict" });
    expect(codex.resumeCalls).toHaveLength(0);
    expect(opencode.resumeCalls).toHaveLength(0);

    // The owning runtime receives the session and its external identity (integration of binding):
    await manager.resumeSession("ses-owned" as never, makeTask("opencode"), {});
    expect(opencode.resumeCalls).toEqual([{ externalSessionId: "ext-ses-owned", runtimeId: "opencode" }]);
  });

  it("16. clears completed executions from the active registry", async () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode"));
    await manager.execute(makeTask("opencode", { executionId: "tx-done" }), {});
    expect(manager.listActiveExecutions()).toEqual([]);
    await expect(manager.cancel({ executionId: "tx-done", runtimeId: "opencode" as never })).rejects.toMatchObject({ code: "not_found" });
  });

  it("17. keeps the runtimeId identity in routed results", async () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode"));
    manager.register(new FakeAdapter("codex"));
    const result = await manager.execute(makeTask("codex", { executionId: "cx-identity" }), {});
    expect(result.runtimeId).toBe("codex");
  });

  it("4b. rejects bindings pointing at unregistered runtimes", () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode"));
    expect(() => manager.bindSession(makeBinding("ses-ghost", "ghost"))).toThrowError(RuntimeManagerError);
    try {
      manager.bindSession(makeBinding("ses-ghost", "ghost"));
    } catch (error) {
      expect((error as RuntimeManagerError).code).toBe("not_found");
    }
  });

  it("edge: re-binding the same session to the same runtime is idempotent", () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode"));
    manager.bindSession(makeBinding("ses-idem", "opencode"));
    manager.bindSession(makeBinding("ses-idem", "opencode"));
    expect(() => manager.bindSession(makeBinding("ses-idem", "opencode"))).not.toThrow();
  });

  it("edge: adapter whose validate identity differs is rejected (no silent substitution)", () => {
    const manager = new RuntimeManager();
    const mismatch = new FakeAdapter("opencode");
    Object.defineProperty(mismatch, "id", { value: "codex" });
    expect(() => manager.register(mismatch)).toThrowError(/equal capabilities\.runtimeId/);
  });
});

/** Review MAO-CORE-03: handle lifecycle, concurrency invariants, error cleanup. */
describe("RuntimeManager review invariants (cancel/concurrency/cleanup)", () => {
  /** Adapter whose plain (non-async) execute throws synchronously. */
  class SyncThrowingAdapter implements RuntimeAdapter {
    readonly id = "opencode" as never;
    capabilities(): RuntimeCapabilities {
      return { ...new FakeAdapter("opencode").capabilities() };
    }
    execute(): Promise<RuntimeResult> {
      throw new Error("sync boom");
    }
  }

  function makeManager(...ids: string[]): { manager: RuntimeManager; adapters: FakeAdapter[] } {
    const manager = new RuntimeManager();
    const adapters = ids.map((id) => {
      const adapter = new FakeAdapter(id);
      adapter.holdAll = true;
      manager.register(adapter);
      return adapter;
    });
    return { manager, adapters };
  }

  it("canceling right after execute() registration reaches the owning adapter", async () => {
    const { manager, adapters } = makeManager("opencode");
    const execution = manager.execute(makeTask("opencode", { executionId: "rv-early" }), {});
    const typed = expect(execution).rejects.toMatchObject({ code: "runtime_aborted" }); // attach before cancel: no unhandled rejection
    await manager.cancel({ executionId: "rv-early", runtimeId: "opencode" as never });
    expect(adapters[0].cancelCalls).toEqual(["rv-early"]);
    await typed;
  });

  it("two parallel executions on one runtime keep independent registry entries", async () => {
    const { manager, adapters } = makeManager("opencode");
    const first = manager.execute(makeTask("opencode", { executionId: "rv-1" }), {});
    const typedFirst = expect(first).rejects.toMatchObject({ code: "runtime_aborted" }); // attached before cancel
    const second = manager.execute(makeTask("opencode", { executionId: "rv-2" }), {});
    const typedSecond = expect(second).rejects.toMatchObject({ code: "runtime_aborted" });
    expect(manager.listActiveExecutions().map((handle) => handle.executionId).sort()).toEqual(["rv-1", "rv-2"]);
    // Cancel one: only its own adapter is touched; the sibling stays registered.
    await manager.cancel({ executionId: "rv-1", runtimeId: "opencode" as never });
    expect(adapters[0].cancelCalls).toEqual(["rv-1"]);
    // Cancel terms the second as well, then both rejections settle deterministically.
    await manager.cancel({ executionId: "rv-2", runtimeId: "opencode" as never });
    expect(adapters[0].cancelCalls).toEqual(["rv-1", "rv-2"]);
    await Promise.all([typedFirst, typedSecond]);
    expect(manager.listActiveExecutions()).toEqual([]);
  });

  it("completion of one task does not evict a held sibling (independent runtimes)", async () => {
    const { manager, adapters } = makeManager("opencode", "codex");
    const heldOne = manager.execute(makeTask("opencode", { executionId: "rv-hold-a" }), {});
    const typedHold = expect(heldOne).rejects.toMatchObject({ code: "runtime_aborted" }); // attached before cancel
    // Second task finishes instantly (registry cleanup runs; the sibling stays held).
    adapters[1].holdAll = false;
    const quickTwo = await manager.execute(makeTask("codex", { executionId: "rv-quick-b" }), {});
    expect(quickTwo.text).toBe("ok-rv-quick-b");
    // The held sibling remains registered and cancellable after the quick one left.
    expect(manager.listActiveExecutions().map((handle) => handle.executionId)).toEqual(["rv-hold-a"]);
    await manager.cancel({ executionId: "rv-hold-a", runtimeId: "opencode" as never });
    await typedHold;
    expect(manager.listActiveExecutions()).toEqual([]);
  });

  it("cross-runtime cancellation touches only the owner (other adapter untouched)", async () => {
    const { manager, adapters } = makeManager("opencode", "codex");
    const first = manager.execute(makeTask("opencode", { executionId: "rv-x1" }), {});
    const typedFirst = expect(first).rejects.toMatchObject({ code: "runtime_aborted" });
    const second = manager.execute(makeTask("codex", { executionId: "rv-x2" }), {});
    const typedSecond = expect(second).rejects.toMatchObject({ code: "runtime_aborted" });
    await expect(manager.cancel({ executionId: "rv-x1", runtimeId: "codex" as never })).rejects.toMatchObject({ code: "identifier_conflict" });
    expect(adapters[0].cancelCalls).toHaveLength(0);
    expect(adapters[1].cancelCalls).toHaveLength(0);
    expect(manager.listActiveExecutions().map((handle) => handle.executionId).sort()).toEqual(["rv-x1", "rv-x2"]);
    // Registry survives a failed foreign cancel:
    await manager.cancel({ executionId: "rv-x2", runtimeId: "codex" as never });
    expect(adapters[1].cancelCalls).toEqual(["rv-x2"]);
    expect(adapters[0].cancelCalls).toHaveLength(0); // rv-x1 stayed untouched while rv-x2 cancelled
    // rv-x1 continues running (its adapter untouched so far) and is then cancelled through its own runtime:
    await manager.cancel({ executionId: "rv-x1", runtimeId: "opencode" as never });
    expect(adapters[0].cancelCalls).toEqual(["rv-x1"]);
    await Promise.all([typedFirst, typedSecond]);
    expect(manager.listActiveExecutions()).toEqual([]);
  });

  it("duplicate in-flight execution ids are rejected instead of overwriting (regression)", async () => {
    const { manager, adapters } = makeManager("opencode");
    const first = manager.execute(makeTask("opencode", { executionId: "rv-dup" }), {});
    await expect(manager.execute(makeTask("opencode", { executionId: "rv-dup" }), {}))
      .rejects.toMatchObject({ code: "identifier_conflict", message: /already in flight/ });
    // First execution stays intact and cancellable:
    expect(adapters[0].executeCalls.every((call) => String(call.task.executionId) === "rv-dup")).toBe(true); // first present, second rejected
    const typedFirst = expect(first).rejects.toMatchObject({ code: "runtime_aborted" });
    await manager.cancel({ executionId: "rv-dup", runtimeId: "opencode" as never });
    await typedFirst;
    expect(manager.listActiveExecutions()).toEqual([]);
  });

  it("duplicate ids across runtimes are refused too (registry is runtime-global)", async () => {
    const { manager, adapters } = makeManager("opencode", "codex");
    void manager.execute(makeTask("opencode", { executionId: "rv-global" }), {});
    await expect(manager.execute(makeTask("codex", { executionId: "rv-global" }), {}))
      .rejects.toMatchObject({ code: "identifier_conflict" });
    expect(adapters[1].executeCalls).toHaveLength(0);
  });

  it("adapter sync throw cleans the active registry", async () => {
    const manager = new RuntimeManager();
    manager.register(new SyncThrowingAdapter());
    await expect(manager.execute(makeTask("opencode", { executionId: "rv-sync" }), {})).rejects.toMatchObject({ message: "sync boom" });
    expect(manager.listActiveExecutions()).toEqual([]);
  });

  it("adapter rejection and user-callback throw clean the active registry", async () => {
    const manager = new RuntimeManager();
    const adapter = new FakeAdapter("opencode");
    adapter.failNext = { code: "runtime_model_rejected", message: "upstream wandered off" };
    manager.register(adapter);
    await expect(manager.execute(makeTask("opencode", { executionId: "rv-reject" }), {})).rejects.toMatchObject({ code: "runtime_model_rejected" });
    expect(manager.listActiveExecutions()).toEqual([]);

    const throwing = new FakeAdapter("codex");
    throwing.callbackThrowNext = true;
    manager.register(throwing);
    await expect(manager.execute(makeTask("codex", { executionId: "rv-callback" }), {
      onEvent: () => { throw new Error("callback exploded"); },
    })).rejects.toMatchObject({ message: "callback exploded" });
    expect(manager.listActiveExecutions()).toEqual([]);
  });

  it("manager diagnostics never expose prompt/text payloads (secret-safety)", async () => {
    const manager = new RuntimeManager();
    manager.register(new FakeAdapter("opencode", { supportedModels: ["opencode-go"] }));
    manager.register(new FakeAdapter("codex", { supportedModels: ["chatgpt-plus"] }));
    const promptText = "SECRET-PROMPT-CONTENT keepout zzzq";
    // Model coverage miss on a registered runtime: deterministic unsupported_capability (not a runtime crash).
    const error = await manager.execute(
      makeTask("codex", { executionId: "rv-sec", modelId: "opencode-go/glm", prompt: promptText }),
      {},
    ).then(() => null, (candidate: RuntimeManagerError) => candidate);
    expect(error?.code).toBe("unsupported_capability");
    expect(JSON.stringify(error)).not.toContain("SECRET-PROMPT-CONTENT");
    expect((error as RuntimeManagerError).details).toMatchObject({ runtimeId: "codex", modelId: "opencode-go/glm" });
  });
});
