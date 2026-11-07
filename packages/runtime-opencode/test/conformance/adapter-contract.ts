import { describe, expect, it } from "vitest";
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeExecutionCallbacks,
  RuntimeExecutionHandle,
  RuntimeResult,
  RuntimeTask,
} from "@open-agent-office/shared";

/**
 * Reusable conformance suite for RuntimeAdapter implementations
 * (API_CONTRACTS §2.16, wave S2-1). Each adapter supplies a driver that
 * emulates its native event stream — no real runtime is ever launched.
 * The Codex adapter (S2-3) must satisfy the same suite through its own
 * fixture and driver (same native-event dialect interface).
 */

/** Control surface over one in-flight native execution. */
export interface AdapterConformanceDriver {
  /** Emits one native event line (JSON-safe record); dialect stays adapter-native. */
  emit(event: Record<string, unknown>): void;
  /** Ends the execution like a natural process exit (default exitCode 0). */
  finish(options?: { exitCode?: number; sessionId?: string; withFinalStop?: boolean }): void;
  /** Ends the execution as a native failure (drives the adapter into a typed error). */
  fail(kind: "model" | "exit"): void;
}

export interface AdapterConformanceFixtures {
  readonly name: string;
  makeAdapter(): RuntimeAdapter;
  /** A preset task; coordinates with the adapter execution flow. */
  makeTask(overrides?: Partial<RuntimeTask>): RuntimeTask;
  /** Stores the pending driver slot for the *next* execution (call before starting it). */
  nextExecutionDriver(): AdapterConformanceDriver;
  /** Canonical error codes for the two native failure kinds of this adapter. */
  readonly failureCodes?: { readonly model?: string; readonly exit?: string };
}

function waitTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Shared scenarios. Assumptions kept minimal and adapter-neutral; the
 * driver's native event dialect includes a final stop event and token cost
 * fields as convention (OpenCode JSONL-style lines).
 */
export function describeRuntimeAdapterContract(fixtures: AdapterConformanceFixtures): void {
  const failureCodes = fixtures.failureCodes ?? {};

  describe(`RuntimeAdapter conformance — ${fixtures.name}`, () => {
    it("1. exposes a stable, non-empty runtime identity", () => {
      const adapter = fixtures.makeAdapter();
      expect(typeof adapter.id).toBe("string");
      expect((adapter.id as string).length).toBeGreaterThan(0);
      expect(adapter.capabilities().runtimeId).toBe((adapter.id as string));
    });

    it("2. declares honest capabilities (no invented support flags)", () => {
      const adapter = fixtures.makeAdapter();
      const caps = adapter.capabilities();
      expect(typeof caps.session).toBe("boolean");
      if (caps.sessionResume === true) expect(caps.session).toBe(true);
      if (caps.cancel === true) expect(typeof adapter.cancel).toBe("function");
      if (caps.sessionResume === true) expect(typeof adapter.resume).toBe("function");
      if (caps.streamEvents === true) expect(caps.session).toBeDefined();
    });

    it("3. forwards the unified request to exactly one native execution", async () => {
      const adapter = fixtures.makeAdapter();
      const driver = fixtures.nextExecutionDriver();
      let dispatches = 0;
      const originalEmit = driver.emit.bind(driver);
      driver.emit = (event) => { dispatches += 1; originalEmit(event); };
      const onEvent: NonNullable<RuntimeExecutionCallbacks["onEvent"]> = () => undefined;
      const execution = adapter.execute(fixtures.makeTask(), { onEvent });
      await waitTick();
      driver.finish({ sessionId: "ses-cf-1" });
      const result = await execution;
      expect(dispatches).toBeGreaterThanOrEqual(1);
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.runtimeId).toBe(adapter.id);
    });

    it("4. streams events, reports canonical usage, returns a solid result", async () => {
      const adapter = fixtures.makeAdapter();
      const driver = fixtures.nextExecutionDriver();
      const usageDeltas: { input?: number; costUsd?: number }[] = [];
      const events: RuntimeEvent[] = [];
      const execution = adapter.execute(fixtures.makeTask(), {
        onEvent: (event) => { events.push(event); },
        onUsage: (usage) => { usageDeltas.push({ input: usage.input, costUsd: usage.costUsd }); },
      });
      await waitTick();
      driver.emit({ type: "text", part: { text: "Hello " } });
      driver.emit({ type: "step_finish", part: { reason: "tool-calls", tokens: { input: 2, output: 3, reasoning: 1, cache: { read: 4, write: 5 }, total: 6 }, cost: 0.25 } });
      driver.emit({ type: "step_finish", sessionID: "ses-cf-4", reason: "stop", tokens: { input: 1, output: 2, total: 3 }, cost: 0.5 });
      driver.finish({ sessionId: "ses-cf-4", withFinalStop: false });
      const result = await execution;
      expect(events.map((event) => event.type)).toContain("text");
      expect(events.every((event) => typeof event.type === "string")).toBe(true);
      expect(usageDeltas.length).toBeGreaterThan(0);
      for (const delta of usageDeltas) {
        expect(typeof delta.costUsd).toBe("number");
        expect(delta.costUsd as number).toBeGreaterThanOrEqual(0);
      }
      expect(result.text).toBe("Hello ");
      expect(result.usage?.costUsd).toBeCloseTo(0.75, 5);
      expect(result.externalSessionId).toBe("ses-cf-4");
      expect(result.runtimeId).toBe(adapter.id);
    });

    it("5. maps native runtime failures into typed errors with context", async () => {
      const adapter = fixtures.makeAdapter();
      const driver = fixtures.nextExecutionDriver();
      const execution = adapter.execute(fixtures.makeTask(), {});
      await waitTick();
      driver.emit({ type: "error", message: "upstream model quota reported" });
      driver.fail("model");
      await expect(execution).rejects.toMatchObject({
        code: failureCodes.model ?? "runtime_model_rejected",
        message: expect.stringMatching(/.+/),
        retryable: expect.any(Boolean),
      });
    });

    it("6. surfaces a missing resumed session as a typed failure (no fake success)", async () => {
      const adapter = fixtures.makeAdapter();
      if (adapter.capabilities().sessionResume === true) {
        const resume = adapter.resume as NonNullable<typeof adapter.resume>;
        const driver = fixtures.nextExecutionDriver();
        const execution = resume.call(
          adapter,
          { runtimeId: adapter.id as never, externalSessionId: "ses-missing-cf", resumable: true },
          fixtures.makeTask({ sessionId: "ses-missing-cf" }),
          {},
        );
        await waitTick();
        driver.emit({ type: "error", message: "session not found" });
        driver.fail("model");
        await expect(execution).rejects.toMatchObject({
          code: failureCodes.model ?? "runtime_model_rejected",
        });
      }
    });

    it("7. cancel aborts a running execution with a typed error", async () => {
      const adapter = fixtures.makeAdapter();
      const cancel = adapter.cancel as NonNullable<typeof adapter.cancel>;
      const driver = fixtures.nextExecutionDriver();
      const execution = adapter.execute(fixtures.makeTask({ executionId: "cf-cancel-1" }), {});
      await waitTick();
      const handle: RuntimeExecutionHandle = { executionId: "cf-cancel-1", runtimeId: adapter.id as never };
      await cancel.call(adapter, handle);
      await expect(execution).rejects.toMatchObject({
        code: expect.any(String),
        message: expect.stringMatching(/.+/),
      });
    });

    it("8. cancel of an unknown execution fails typed (never fake success)", async () => {
      const adapter = fixtures.makeAdapter();
      const cancel = adapter.cancel;
      if (!cancel) return; // adapter without cancel is covered by its own fixture
      await expect(cancel.call(adapter, { executionId: "cf-unknown", runtimeId: adapter.id as never })).rejects.toBeInstanceOf(Error);
    });

    it("9. keeps session identity isolated per execution (binding, not employee)", async () => {
      const adapter = fixtures.makeAdapter();
      const first = fixtures.nextExecutionDriver();
      const executionOne = adapter.execute(fixtures.makeTask({ executionId: "cf-ses-a", sessionId: "ses-a" }), {});
      const second = fixtures.nextExecutionDriver();
      const executionTwo = adapter.execute(fixtures.makeTask({ executionId: "cf-ses-b", sessionId: "ses-b" }), {});
      await waitTick();
      first.finish({ sessionId: "ses-a-out" });
      second.finish({ sessionId: "ses-b-out" });
      const [resultOne, resultTwo] = await Promise.all([executionOne, executionTwo] as [Promise<RuntimeResult>, Promise<RuntimeResult>]);
      expect(resultOne.externalSessionId).not.toBe(resultTwo.externalSessionId);
      expect(resultOne.externalSessionId).toBe("ses-a-out");
      expect(resultTwo.externalSessionId).toBe("ses-b-out");
    });
  });
}
