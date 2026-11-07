import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { symlinkSync, unlinkSync } from "node:fs";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { FakeOpenCodeBackend, OpenCodeRuntimeAdapter, ProductionOpenCodeBackend, OpenCodeAdapterError, type SpawnFunction } from "../src/index.js";

type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
function spawnFake(script: (child: FakeChild) => void, calls: { command?: string; args?: readonly string[]; options?: SpawnOptions }): SpawnFunction {
  return ((command: string, args: readonly string[], options: SpawnOptions) => {
    calls.command = command; calls.args = args; calls.options = options;
    const child = new EventEmitter() as FakeChild;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = vi.fn((signal: string) => { child.emit("close", signal === "SIGKILL" ? 137 : 143); return true; });
    queueMicrotask(() => script(child));
    return child as unknown as ChildProcess;
  }) as unknown as SpawnFunction;
}

const task = { model: "opencode-go/test-model", prompt: "safe", cwd: "/tmp", title: "offline" };
const line = (value: unknown) => `${JSON.stringify(value)}\n`;

describe("OpenCode production backend", () => {
  it("uses the documented non-interactive JSON protocol without shell", async () => {
    const calls: { command?: string; args?: readonly string[]; options?: SpawnOptions } = {};
    const backend = new ProductionOpenCodeBackend({ supportedModels: [task.model], authenticated: true, available: true, allowedCwdRoots: ["/tmp"], spawn: spawnFake((child) => { child.stdout.end(line({ type: "text", text: "ok" }) + line({ type: "step_finish", reason: "stop" })); child.emit("close", 0); }, calls) });
    const result = await backend.runTask(task);
    expect(result.text).toBe("ok"); expect(calls.command).toBe("opencode"); expect(calls.options?.shell).toBe(false);
    expect(calls.args).toEqual(["run", "--dir", "/tmp", "--model", task.model, "--format", "json", "--title", "offline", "safe"]);
  });

  it("blocks unverified authentication, unknown models and symlink escapes", async () => {
    const unavailable = new ProductionOpenCodeBackend({ supportedModels: [task.model], authenticated: false, available: false, allowedCwdRoots: ["/tmp"], spawn: spawnFake(() => undefined, {}) });
    await expect(unavailable.runTask(task)).rejects.toThrow(/unverified/);
    const backend = new ProductionOpenCodeBackend({ supportedModels: [task.model], authenticated: true, available: true, allowedCwdRoots: ["/tmp"], spawn: spawnFake(() => undefined, {}) });
    await expect(backend.runTask({ ...task, model: "opencode-go/unknown" })).rejects.toThrow(/confirmed/);
    const link = `/tmp/mao-opencode-link-${process.pid}`;
    try { symlinkSync("/etc", link); await expect(backend.runTask({ ...task, cwd: link })).rejects.toThrow(/workspace/); } finally { try { unlinkSync(link); } catch { /* already absent */ } }
  });

  it("keeps the fake backend available for injected offline adapter tests", () => {
    const fake = new FakeOpenCodeBackend();
    const adapter = new OpenCodeRuntimeAdapter({ runtime: fake });
    expect(adapter.capabilities().runtimeId).toBe("opencode");
    expect(fake.capabilities().available).toBe(true);
  });

  it("rejects foreign runtime handles and unverified production models before process use", async () => {
    let spawnCalls = 0;
    const runtime = new ProductionOpenCodeBackend({
      supportedModels: [task.model], authenticated: true, available: true, allowedCwdRoots: ["/tmp"],
      spawn: ((...args: Parameters<SpawnFunction>) => { spawnCalls += 1; return spawnFake(() => undefined, {})(...args); }) as SpawnFunction,
    });
    const adapter = new OpenCodeRuntimeAdapter({ runtime });
    await expect(adapter.execute({ executionId: "foreign", attempt: 1, runtimeId: "codex" as never, modelId: task.model, prompt: "p", cwd: "/tmp" })).rejects.toMatchObject({ name: "OpenCodeAdapterError", code: "identifier_conflict" });
    await expect(adapter.execute({ executionId: "unknown-model", attempt: 1, runtimeId: "opencode" as never, modelId: "opencode-go/unknown", prompt: "p", cwd: "/tmp" })).rejects.toMatchObject({ name: "OpenCodeAdapterError", code: "runtime_model_rejected" });
    await expect(adapter.cancel({ executionId: "x", runtimeId: "codex" as never })).rejects.toBeInstanceOf(OpenCodeAdapterError);
    expect(spawnCalls).toBe(0);
  });

  it("rejects malformed, empty, or duplicate production model declarations", () => {
    const options = { authenticated: true, available: true, allowedCwdRoots: ["/tmp"] as const };
    expect(() => new ProductionOpenCodeBackend({ ...options, supportedModels: [] })).toThrow(TypeError);
    expect(() => new ProductionOpenCodeBackend({ ...options, supportedModels: ["*"] })).toThrow(TypeError);
    expect(() => new ProductionOpenCodeBackend({ ...options, supportedModels: ["opencode-go/model", "opencode-go/model"] })).toThrow(TypeError);
    expect(() => new ProductionOpenCodeBackend({ ...options, provider: "", supportedModels: ["/model"] })).toThrow(TypeError);
  });
});
