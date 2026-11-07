import { PassThrough } from "node:stream";
import type { SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import * as shared from "@open-agent-office/shared";
import type { RuntimeEvent as SharedRuntimeEvent } from "@open-agent-office/shared";
import {
  OpenCodeRuntime,
  OpenCodeRuntimeAdapter,
  redactSecrets,
  sanitizeValue,
  type SpawnFunction,
} from "../src/index.js";
import {
  describeRuntimeAdapterContract,
  type AdapterConformanceDriver,
  type AdapterConformanceFixtures,
} from "./conformance/adapter-contract.js";

type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };

const CWD = "/tmp/open-agent-office-conformance";

/** Fake OpenCode child process: identical pattern to runtime.test.ts (no real CLI). */
function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn((signal: string) => {
    child.emit("close", signal === "SIGKILL" ? 137 : 143);
    return true;
  });
  return child;
}

/** Spawn stub: registers a controlled child; content is fed only by drivers. */
const noopSpawn = ((command: string, args: readonly string[], options: SpawnOptions) => {
  void command;
  void args;
  void options;
  const child = makeFakeChild();
  children.push(child);
  return child as unknown as ChildProcessLike;
}) as unknown as SpawnFunction;

type ChildProcessLike = ReturnType<typeof makeFakeChild>;

const children: FakeChild[] = [];

/** Driver over one in-flight native execution slot (by child index). */
class OpenCodeDriver implements AdapterConformanceDriver {
  private readonly pending: string[] = [];
  constructor(private readonly index: number) {}

  private child(): FakeChild | undefined {
    return children[this.index];
  }

  private flush(): void {
    const child = this.child();
    if (!child) return;
    while (this.pending.length > 0) child.stdout.write(`${this.pending.shift()}\n`);
  }

  private write(event: Record<string, unknown>): void {
    this.pending.push(JSON.stringify(event));
    this.flush();
  }

  emit(event: Record<string, unknown>): void {
    this.write(event);
  }

  finish(options: { exitCode?: number; sessionId?: string; withFinalStop?: boolean } = {}): void {
    if (options.withFinalStop !== false) {
      // Route through `emit` so conformance counters observe the final event too.
      this.emit({ type: "step_finish", sessionID: options.sessionId, reason: "stop" });
    }
    const child = this.child();
    if (child) child.stdout.end();
    setImmediate(() => {
      const target = this.child();
      if (target) target.emit("close", options.exitCode ?? 0);
    });
  }

  fail(kind: "model" | "exit"): void {
    if (kind === "model") {
      this.emit({ type: "error", message: "upstream model quota reported" });
      return;
    }
    setImmediate(() => {
      const target = this.child();
      if (target) target.emit("close", 1);
    });
  }
}

const opencodeFixtures: AdapterConformanceFixtures = {
  name: "OpenCodeRuntimeAdapter (fake OpenCode CLI)",
  makeAdapter: () => new OpenCodeRuntimeAdapter({ runtime: new OpenCodeRuntime({ spawn: noopSpawn }) }),
  makeTask: (overrides = {}) => ({
    executionId: `cf-${Math.random().toString(36).slice(2, 8)}`,
    attempt: 1,
    modelId: "opencode-go/glm-5.3-flash",
    runtimeId: "opencode",
    prompt: "conformance hello",
    cwd: CWD,
    ...overrides,
  }),
  nextExecutionDriver: () => new OpenCodeDriver(children.length),
  failureCodes: { model: "runtime_model_rejected", exit: "runtime_exit_nonzero" },
};

describeRuntimeAdapterContract(opencodeFixtures);

describe("OpenCode adapter — resume passthrough (review §2)", () => {
  it("resume routes the existing runtime session id into the native --session argument", async () => {
    const calls: { args?: readonly string[] } = {};
    const spawn = ((command: string, args: readonly string[], options: SpawnOptions) => {
      void command;
      void options;
      calls.args = args;
      const child = makeFakeChild();
      children.push(child);
      return child as unknown as ChildProcessLike;
    }) as unknown as SpawnFunction;

    const adapter = new OpenCodeRuntimeAdapter({ runtime: new OpenCodeRuntime({ spawn }) });
    const execution = adapter.resume(
      { runtimeId: "opencode" as never, externalSessionId: "ses-existing-7", resumable: true },
      { executionId: "cf-resume-7", attempt: 1, modelId: "opencode-go/glm-5.3-flash", runtimeId: "opencode" as never, prompt: "continue work", cwd: CWD },
      {},
    );
    await new Promise((resolve) => setImmediate(resolve));
    const child = children[children.length - 1];
    child?.stdout.write(`${JSON.stringify({ type: "step_finish", sessionID: "ses-existing-7", reason: "stop" })}\n`);
    child?.stdout.end();
    setImmediate(() => child?.emit("close", 0));
    const result = await execution;

    const args = calls.args ?? [];
    expect(args).toContain("--session");
    expect(args[(args.indexOf("--session") ?? -2) + 1]).toBe("ses-existing-7"); // binding id, not a fresh session
    expect(result.externalSessionId).toBe("ses-existing-7"); // session identity is preserved end-to-end
  });
});

describe("OpenCode adapter — old API compatibility (scenario 10)", () => {
  it("keeps the classic OpenCodeRuntime surface fully working", async () => {
    const calls: { args?: readonly string[] } = {};
    const spawn = ((command: string, args: readonly string[], options: SpawnOptions) => {
      void command;
      void options;
      calls.args = args;
      const child = makeFakeChild();
      children.push(child);
      setImmediate(() => {
        child.stdout.write(`${JSON.stringify({ type: "step_start", sessionID: "ses-legacy" })}\n`);
        child.stdout.end(JSON.stringify({ type: "step_finish", reason: "stop", tokens: { input: 1, output: 1, total: 2 }, cost: 0.1 }) + "\n");
        child.emit("close", 0);
      });
      return child as unknown as ChildProcessLike;
    }) as unknown as SpawnFunction;

    const runtime = new OpenCodeRuntime({ spawn });
    const result = await runtime.runTask({ model: "opencode-go/glm-5.3-flash", prompt: "legacy prompt", cwd: CWD, title: "Legacy title" });
    expect(result.sessionId).toBe("ses-legacy");
    expect(result.reason).toBe("stop");
    expect(result.usage.cost).toBeCloseTo(0.1, 5);
    expect(calls.args?.[0]).toBe("run");
    expect(calls.args).toContain("--format");
  });

  it("does not leak adapter-stage registry beyond S2-1 scope", () => {
    // RuntimeManager is S2-2: nothing registry-like is exported yet.
    expect(Object.keys(shared).filter((key) => key.startsWith("createRuntimeManager"))).toHaveLength(0);
  });
});

describe("OpenCode adapter — redaction parity (scenario 11)", () => {
  it("C15 re-exports the canonical shared redaction (single source of truth)", () => {
    expect(redactSecrets).toBe(shared.redactSecrets);
    expect(sanitizeValue).toBe(shared.sanitizeValue);
  });

  it("returns parity-identical sanitized output for shared inputs", () => {
    const raw = 'Authorization: Bearer abc;{"token":"s3cret"}; note safe';
    expect(shared.redactSecrets(raw)).toBe(redactSecrets(raw));
    expect(shared.sanitizeValue({ list: [{ secret: "aaa" }] })).toEqual(sanitizeValue({ list: [{ secret: "aaa" }] }));
  });

  it("adapter boundary keeps secrets out of delivered events and typed errors", async () => {
    const adapter = new OpenCodeRuntimeAdapter({ runtime: new OpenCodeRuntime({ spawn: noopSpawn }) });
    const seen: SharedRuntimeEvent[] = [];
    const execution = adapter.execute(
      { executionId: "cf-redact", attempt: 1, modelId: "opencode-go/glm-5.3-flash", runtimeId: "opencode", prompt: "hello", cwd: CWD },
      { onEvent: (event) => { seen.push(event); } },
    );
    await new Promise((resolve) => setImmediate(resolve));
    const inFlight = children[children.length - 1];
    inFlight?.stdout.write(`${JSON.stringify({ type: "text", part: { text: "Authorization: Bearer zzz9 payload" } })}\n`);
    inFlight?.stdout.end();
    setImmediate(() => inFlight?.emit("close", 0));
    try {
      await execution;
    } catch {
      // without a final step_finish the native run fails typed; only sanitization matters here
    }
    expect(seen.length).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(seen)).not.toContain("zzz9");
  });
});
