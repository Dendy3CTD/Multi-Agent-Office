import { PassThrough } from "node:stream";
import type { SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  OpenCodeRuntime,
  OpenCodeLaunchError,
  RuntimeAbortError,
  RuntimeExitError,
  RuntimeIncompleteError,
  RuntimeEventCallbackError,
  RuntimeUsageCallbackError,
  RuntimeModelError,
  RuntimeProtocolError,
  RuntimeTimeoutError,
  RuntimeError,
  type SpawnFunction,
} from "../src/index";

type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };

function fakeSpawn(script: (child: FakeChild) => void, calls: { command?: string; args?: readonly string[]; options?: SpawnOptions }): SpawnFunction {
  return ((command: string, args: readonly string[], options: SpawnOptions) => {
    calls.command = command;
    calls.args = args;
    calls.options = options;
    const child = new EventEmitter() as FakeChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn((signal: string) => {
      child.emit("close", signal === "SIGKILL" ? 137 : 143);
      return true;
    });
    queueMicrotask(() => { child.emit("spawn"); script(child); });
    return child;
  }) as unknown as SpawnFunction;
}

const event = (value: unknown) => JSON.stringify(value) + "\n";
const cwd = "/tmp/open-agent-office-runtime-test";

describe("OpenCodeRuntime", () => {
  it("launches with safe, explicit arguments and collects session/text/usage", async () => {
    const calls: { command?: string; args?: readonly string[]; options?: Record<string, unknown> } = {};
    const onEvent = vi.fn();
    const runtime = new OpenCodeRuntime({ spawn: fakeSpawn((child) => {
      child.stdout.end(event({ type: "step_start", sessionID: "ses-1" }) + event({ type: "text", part: { text: "Hello " } }) + event({ type: "text", text: "world" }) + event({ type: "step_finish", part: { reason: "tool-calls", tokens: { input: 2, output: 3, reasoning: 1, cache: { read: 4, write: 5 }, total: 10 }, cost: 0.25 } }) + event({ type: "step_finish", sessionID: "ses-1", reason: "stop", tokens: { input: 6, output: 7, total: 13 }, cost: 0.5 }));
      child.stderr.end("diagnostic only\n");
      setImmediate(() => child.emit("close", 0));
    }, calls) });
    const result = await runtime.runTask({ model: "provider/model", prompt: "say hi", cwd, title: "Test title", onEvent });
    expect(calls.command).toBe("opencode");
    expect(calls.args).toEqual(["run", "--dir", cwd, "--model", "provider/model", "--format", "json", "--title", "Test title", "say hi"]);
    expect(calls.options?.shell).toBe(false);
    expect(calls.options?.cwd).toBe(cwd);
    expect(result.sessionId).toBe("ses-1");
    expect(result.text).toBe("Hello world");
    expect(result.reason).toBe("stop");
    expect(result.events).toHaveLength(5);
    expect(onEvent).toHaveBeenCalledTimes(5);
    expect(result.usage).toEqual({ input: 8, output: 10, reasoning: 1, cacheRead: 4, cacheWrite: 5, total: 23, cost: 0.75 });
  });

  it("supports continuation and parses JSON split across chunks and multiple events per chunk", async () => {
    const calls: { args?: readonly string[] } = {};
    const runtime = new OpenCodeRuntime({ spawn: fakeSpawn((child) => {
      const payload = event({ type: "text", text: "split" }) + event({ type: "step_finish", reason: "stop" });
      child.stdout.write(payload.slice(0, 9));
      child.stdout.end(payload.slice(9));
      setImmediate(() => child.emit("close", 0));
    }, calls) });
    const result = await runtime.runTask({ model: "m", prompt: "p", cwd, title: "t", sessionId: "old-session" });
    expect(calls.args).toContain("--session");
    expect(calls.args).toContain("old-session");
    expect(result.text).toBe("split");
  });

  it("preserves unknown events and reports model error events", async () => {
    const runtime = new OpenCodeRuntime({ spawn: fakeSpawn((child) => {
      child.stdout.end(event({ type: "future_event", data: { safe: true } }) + event({ type: "error", error: { message: "model failed" } }));
      setImmediate(() => child.emit("close", 1));
    }, {}) });
    await expect(runtime.runTask({ model: "m", prompt: "p", cwd, title: "t" })).rejects.toBeInstanceOf(RuntimeModelError);
  });

  it("accepts a final JSONL record without LF and preserves split UTF-8", async () => {
    const runtime = new OpenCodeRuntime({ spawn: fakeSpawn((child) => {
      const payload = Buffer.from(event({ type: "text", text: "Привет" }) + JSON.stringify({ type: "step_finish", reason: "stop" }));
      const split = payload.indexOf(Buffer.from("и").subarray(0, 1));
      child.stdout.write(payload.subarray(0, split + 1));
      child.stdout.end(payload.subarray(split + 1));
      setImmediate(() => child.emit("close", 0));
    }, {}) });
    const result = await runtime.runTask({ model: "m", prompt: "p", cwd, title: "t" });
    expect(result.text).toBe("Привет");
    expect(result.reason).toBe("stop");
  });

  it("rejects a damaged final JSONL record and only step_finish can finish", async () => {
    const damaged = new OpenCodeRuntime({ spawn: fakeSpawn((child) => {
      child.stdout.end('{"type":"step_finish","reason":"stop"');
      setImmediate(() => child.emit("close", 0));
    }, {}) });
    await expect(damaged.runTask({ model: "m", prompt: "p", cwd, title: "t" })).rejects.toBeInstanceOf(RuntimeProtocolError);
    const toolCallsOnly = new OpenCodeRuntime({ spawn: fakeSpawn((child) => {
      child.stdout.end(event({ type: "text", reason: "stop", text: "not final" }) + event({ type: "future", reason: "stop" }) + event({ type: "step_finish", reason: "tool-calls" }));
      setImmediate(() => child.emit("close", 0));
    }, {}) });
    await expect(toolCallsOnly.runTask({ model: "m", prompt: "p", cwd, title: "t" })).rejects.toBeInstanceOf(RuntimeIncompleteError);
  });

  it("rejects non-zero exits, incomplete runs, invalid JSON, and relative cwd", async () => {
    const failed = new OpenCodeRuntime({ spawn: fakeSpawn((child) => { child.stderr.end("failed safely"); setImmediate(() => child.emit("close", 2)); }, {}) });
    await expect(failed.runTask({ model: "m", prompt: "p", cwd, title: "t" })).rejects.toBeInstanceOf(RuntimeExitError);
    const incomplete = new OpenCodeRuntime({ spawn: fakeSpawn((child) => { child.stdout.end(event({ type: "step_finish", reason: "tool-calls" })); setImmediate(() => child.emit("close", 0)); }, {}) });
    await expect(incomplete.runTask({ model: "m", prompt: "p", cwd, title: "t" })).rejects.toBeInstanceOf(RuntimeIncompleteError);
    const invalid = new OpenCodeRuntime({ spawn: fakeSpawn((child) => { child.stdout.end("{broken}\n"); setImmediate(() => child.emit("close", 0)); }, {}) });
    await expect(invalid.runTask({ model: "m", prompt: "p", cwd, title: "t" })).rejects.toBeInstanceOf(RuntimeProtocolError);
    await expect(failed.runTask({ model: "m", prompt: "p", cwd: "relative", title: "t" })).rejects.toBeInstanceOf(OpenCodeLaunchError);
  });

  it("supports abort and timeout with termination", async () => {
    const controller = new AbortController();
    let child: FakeChild | undefined;
    const runtime = new OpenCodeRuntime({ terminateGraceMs: 5, spawn: fakeSpawn((created) => { child = created; }, {}) });
    const aborted = runtime.runTask({ model: "m", prompt: "p", cwd, title: "t", signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(RuntimeAbortError);
    expect(child?.kill).toHaveBeenCalledWith("SIGTERM");
    const timeoutChild: { value?: FakeChild } = {};
    const timeoutRuntime = new OpenCodeRuntime({ terminateGraceMs: 5, spawn: fakeSpawn((created) => { timeoutChild.value = created; }, {}) });
    await expect(timeoutRuntime.runTask({ model: "m", prompt: "p", cwd, title: "t", timeoutMs: 1 })).rejects.toBeInstanceOf(RuntimeTimeoutError);
    expect(timeoutChild.value?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not settle cancellation until close and escalates SIGTERM to SIGKILL", async () => {
    let child!: FakeChild;
    const spawn: SpawnFunction = ((() => {
      child = new EventEmitter() as FakeChild;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      return child;
    }) as unknown) as SpawnFunction;
    const controller = new AbortController();
    const runtime = new OpenCodeRuntime({ spawn, terminateGraceMs: 10 });
    const task = runtime.runTask({ model: "m", prompt: "p", cwd, title: "t", signal: controller.signal });
    let settled = false;
    void task.then(() => { settled = true; }, () => { settled = true; });
    controller.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("close", 137);
    await expect(task).rejects.toBeInstanceOf(RuntimeAbortError);
  });

  it("turns onEvent exceptions into a typed error after close", async () => {
    const runtime = new OpenCodeRuntime({ spawn: fakeSpawn((child) => {
      child.stdout.end(event({ type: "text", text: "callback" }) + event({ type: "step_finish", reason: "stop" }));
      setImmediate(() => child.emit("close", 0));
    }, {}) });
    const task = runtime.runTask({ model: "m", prompt: "p", cwd, title: "t", onEvent: () => { throw new Error("callback secret"); } });
    await expect(task).rejects.toBeInstanceOf(RuntimeEventCallbackError);
  });

  it("bounds stdout and terminates after a buffer overflow", async () => {
    const childHolder: { child?: FakeChild } = {};
    const runtime = new OpenCodeRuntime({ maxBufferBytes: 32, spawn: fakeSpawn((child) => {
      childHolder.child = child;
      child.stdout.end("x".repeat(128));
      setImmediate(() => child.emit("close", 143));
    }, {}) });
    await expect(runtime.runTask({ model: "m", prompt: "p", cwd, title: "t" })).rejects.toBeInstanceOf(RuntimeProtocolError);
    expect(childHolder.child?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("waits for close when a protocol error triggers termination", async () => {
    let child!: FakeChild;
    const spawn: SpawnFunction = ((() => {
      child = new EventEmitter() as FakeChild;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      return child;
    }) as unknown) as SpawnFunction;
    const runtime = new OpenCodeRuntime({ spawn, terminateGraceMs: 10 });
    const task = runtime.runTask({ model: "m", prompt: "p", cwd, title: "t" });
    let settled = false;
    void task.then(() => { settled = true; }, () => { settled = true; });
    child.stdout.end("{broken}\n");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("close", 143);
    await expect(task).rejects.toBeInstanceOf(RuntimeProtocolError);
  });

  it("bounds stderr once and validates memory-related options", async () => {
    const runtime = new OpenCodeRuntime({ maxBufferBytes: 64, spawn: fakeSpawn((child) => {
      child.stderr.write("diagnostic ".repeat(100));
      child.stdout.end(event({ type: "error", message: "failed" }));
      setImmediate(() => child.emit("close", 1));
    }, {}) });
    const failure = await runtime.runTask({ model: "m", prompt: "p", cwd, title: "t" }).catch((error) => error as RuntimeModelError) as unknown as RuntimeModelError;
    expect(failure).toBeInstanceOf(RuntimeModelError);
    expect(failure.stderr.length).toBeLessThanOrEqual(64);
    expect((failure.stderr.match(/\[stderr truncated\]/g) ?? []).length).toBe(1);
    expect(() => new OpenCodeRuntime({ maxBufferBytes: 0 })).toThrow(RangeError);
    expect(() => new OpenCodeRuntime({ maxBufferBytes: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => new OpenCodeRuntime({ terminateGraceMs: -1 })).toThrow(RangeError);
    expect(() => new OpenCodeRuntime({ terminateGraceMs: Number.NaN })).toThrow(RangeError);
  });

  it("redacts common secrets in errors, events, and stderr", async () => {
    const runtime = new OpenCodeRuntime({ maxBufferBytes: 4096, spawn: fakeSpawn((child) => {
      child.stderr.end("Authorization: Bearer bearer-secret api_key=key-secret apiKey: json-key access_token=access-secret token=password-secret");
      child.stdout.end(event({ type: "error", error: { message: "Authorization: Bearer event-secret", token: "token-secret", password: "password-secret", secret: "secret-value" } }));
      setImmediate(() => child.emit("close", 1));
    }, {}) });
    const failure = await runtime.runTask({ model: "m", prompt: "p", cwd, title: "t" }).catch((error) => error as RuntimeModelError) as unknown as RuntimeModelError;
    const serialized = JSON.stringify(failure);
    for (const secret of ["bearer-secret", "key-secret", "json-key", "access-secret", "password-secret", "event-secret", "token-secret", "secret-value"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("[REDACTED]");
    expect(new RuntimeError("Authorization: Bearer direct-secret").message).not.toContain("direct-secret");
  });

  it("handles launch errors, large streams, and never adds --auto or leaks secrets", async () => {
    const launch = new OpenCodeRuntime({ spawn: (() => { throw new Error("spawn failed SECRET_TOKEN"); }) as SpawnFunction });
    await expect(launch.runTask({ model: "m", prompt: "p", cwd, title: "t" })).rejects.toMatchObject({ name: "OpenCodeLaunchError" });
    const secret = "SECRET_TOKEN";
    const calls: { args?: readonly string[] } = {};
    const runtime = new OpenCodeRuntime({ maxBufferBytes: 2 * 1024 * 1024, spawn: fakeSpawn((child) => {
      child.stderr.end("x".repeat(100_000));
      child.stdout.end(event({ type: "text", text: "x".repeat(100_000) }) + event({ type: "step_finish", reason: "stop" }));
      setImmediate(() => child.emit("close", 0));
    }, calls) });
    const result = await runtime.runTask({ model: "m", prompt: `do not log ${secret}`, cwd, title: "t" });
    expect(result.text).toHaveLength(100_000);
    expect(calls.args).not.toContain("--auto");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("reports one usage delta per usage-bearing event and their sum equals result.usage", async () => {
    const onUsage = vi.fn();
    const onEvent = vi.fn();
    const runtime = new OpenCodeRuntime({ spawn: fakeSpawn((child) => {
      child.stdout.end(
        event({ type: "text", text: "no usage here" }) +
        event({ type: "step_finish", sessionID: "ses-u", part: { tokens: { input: 2, output: 3, reasoning: 1, cache: { read: 4, write: 5 }, total: 10 }, cost: 0.25 } }) +
        event({ type: "step_finish", reason: "stop", tokens: { input: 6, output: 7, total: 13 }, cost: 0.5 }),
      );
      setImmediate(() => child.emit("close", 0));
    }, {}) });
    const result = await runtime.runTask({ model: "m", prompt: "p", cwd, title: "t", onUsage, onEvent });
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledTimes(3);
    const [first, second] = onUsage.mock.calls.map((call) => call[0]);
    expect(first).toEqual({ input: 2, output: 3, reasoning: 1, cacheRead: 4, cacheWrite: 5, total: 10, cost: 0.25 });
    expect(second).toEqual({ input: 6, output: 7, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 13, cost: 0.5 });
    const summed = onUsage.mock.calls.reduce((total, [usage]) => ({
      input: total.input + usage.input,
      output: total.output + usage.output,
      reasoning: total.reasoning + usage.reasoning,
      cacheRead: total.cacheRead + usage.cacheRead,
      cacheWrite: total.cacheWrite + usage.cacheWrite,
      total: total.total + usage.total,
      cost: total.cost + usage.cost,
    }), { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 });
    expect(summed).toEqual(result.usage);
    expect(result.usage.total).toBe(23);
  });

  it("calls onUsage with the event (redacted) and before onEvent, so usage survives a throwing onEvent", async () => {
    const order: string[] = [];
    const usageEvents: unknown[] = [];
    const runtime = new OpenCodeRuntime({ spawn: fakeSpawn((child) => {
      child.stdout.end(event({ type: "step_finish", reason: "stop", api_key: "callback-secret", tokens: { input: 1, output: 1, total: 2 } }));
      setImmediate(() => child.emit("close", 0));
    }, {}) });
    const task = runtime.runTask({
      model: "m", prompt: "p", cwd, title: "t",
      onUsage: (_usage, sourceEvent) => { order.push("usage"); usageEvents.push(sourceEvent); },
      onEvent: () => { order.push("event"); throw new Error("onEvent failed"); },
    });
    await expect(task).rejects.toBeInstanceOf(RuntimeEventCallbackError);
    expect(order).toEqual(["usage", "event"]);
    expect(JSON.stringify(usageEvents)).not.toContain("callback-secret");
  });

  it("turns onUsage exceptions into a typed error, terminates the process and waits for close", async () => {
    const holder: { child?: FakeChild } = {};
    const runtime = new OpenCodeRuntime({ terminateGraceMs: 5, spawn: fakeSpawn((child) => {
      holder.child = child;
      child.stdout.write(event({ type: "step_finish", tokens: { input: 1, total: 1 } }));
    }, {}) });
    const failure = await runtime.runTask({ model: "m", prompt: "p", cwd, title: "t", onUsage: () => { throw new Error("storage down"); } }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RuntimeUsageCallbackError);
    expect((failure as RuntimeError).message).toContain("storage down");
    expect(holder.child?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not call onUsage for events without token metrics and never double counts a single event", async () => {
    const onUsage = vi.fn();
    const runtime = new OpenCodeRuntime({ spawn: fakeSpawn((child) => {
      child.stdout.end(event({ type: "text", text: "a" }) + event({ type: "step_start", sessionID: "s" }) + event({ type: "step_finish", reason: "stop", tokens: { input: 4, total: 4 } }));
      setImmediate(() => child.emit("close", 0));
    }, {}) });
    const result = await runtime.runTask({ model: "m", prompt: "p", cwd, title: "t", onUsage });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(result.usage.input).toBe(4);
    expect(result.usage.total).toBe(4);
  });
});
