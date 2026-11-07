import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { CodexBackendFailure, ProductionCodexBackend } from "../src/index.js";

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;
  autoClose = true;
  kill(): boolean { this.killed = true; if (this.autoClose) queueMicrotask(() => this.emit("close", null)); return true; }
  emitOutput(value: string): void { this.stdout.emit("data", Buffer.from(value)); }
  emitError(value: string): void { this.stderr.emit("data", Buffer.from(value)); }
  close(code = 0): void { this.emit("close", code); }
}

function makeHarness() {
  let child: FakeChild | undefined;
  let invocation: { command: string; args: readonly string[]; options: Record<string, unknown> } | undefined;
  const backend = new ProductionCodexBackend({
    command: "codex-test",
    supportedModels: ["gpt-test"],
    provider: "chatgpt-plus",
    authenticated: true,
    available: true,
    allowedCwdRoots: ["/tmp"],
    spawn: (command, args, options) => { child = new FakeChild(); invocation = { command, args, options: options as Record<string, unknown> }; return child as unknown as ChildProcess; },
  });
  return { backend, child: () => child!, invocation: () => invocation! };
}

const task = { executionId: "production-test", attempt: 1, modelId: "gpt-test", prompt: "safe prompt", cwd: "/tmp", timeoutMs: 1000 };

describe("ProductionCodexBackend", () => {
  it("spawns the official exec interface without a shell and parses fragmented JSONL", async () => {
    const h = makeHarness(); const events: unknown[] = []; const usage: unknown[] = [];
    const run = h.backend.execute(task, { onEvent: event => events.push(event), onUsage: value => usage.push(value) });
    expect(h.invocation()).toMatchObject({ command: "codex-test", options: { shell: false, cwd: "/tmp" } });
    expect(h.invocation().args).toEqual(["exec", "--experimental-json", "--sandbox", "read-only", "--cd", "/tmp", "--model", "gpt-test", "safe prompt"]);
    h.child().emitOutput('{"type":"item.completed","item":{"text":"hel'); h.child().emitOutput('lo"}}\n{"type":"turn.completed","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}\n'); h.child().close();
    const result = await run.completion;
    expect(result.text).toBe("hello"); expect(result.records).toHaveLength(2); expect(usage).toHaveLength(1); expect(events).toHaveLength(2);
  });

  it("does not claim readiness or model coverage without verified snapshots", () => {
    const backend = new ProductionCodexBackend({ supportedModels: [] });
    expect(backend.capabilities().supportedModels).toEqual([]);
    expect(JSON.stringify(backend.capabilities().notes)).toContain("unverified");
    expect(() => backend.execute(task, {})).toThrow(CodexBackendFailure);
  });

  it("rejects unconfirmed models and cwd escapes before spawning", () => {
    const h = makeHarness();
    expect(() => h.backend.execute({ ...task, modelId: "gpt-unknown" }, {})).toThrow(/not confirmed/);
    expect(() => h.backend.execute({ ...task, cwd: "/etc" }, {})).toThrow(/allowed Codex workspace/);
  });

  it("maps malformed structured output and nonzero exits to typed failures", async () => {
    const malformed = makeHarness(); const first = malformed.backend.execute(task, {}); malformed.child().emitOutput("not-json\n"); await expect(first.completion).rejects.toMatchObject({ kind: "protocol" });
    const failed = makeHarness(); const second = failed.backend.execute(task, {}); failed.child().emitError("Authorization: Bearer secret-value"); failed.child().close(7); await expect(second.completion).rejects.toMatchObject({ kind: "exit" });
  });

  it("aborts and cleans an active process without a second execution", async () => {
    const h = makeHarness(); const controller = new AbortController(); const run = h.backend.execute({ ...task, signal: controller.signal }, {}); controller.abort(); await expect(run.completion).rejects.toMatchObject({ kind: "abort" }); expect(h.child().killed).toBe(true); expect(() => h.backend.cancel(task.executionId)).toThrow(/not active/);
  });

  it("does not reject cancellation before the child confirms close", async () => {
    let process!: FakeChild;
    const backend = new ProductionCodexBackend({ supportedModels: ["gpt-test"], authenticated: true, available: true, allowedCwdRoots: ["/tmp"], spawn: () => { process = new FakeChild(); process.autoClose = false; return process as unknown as ChildProcess; } });
    const run = backend.execute(task, {}); backend.cancel(task.executionId); let settled = false; void run.completion.then(() => { settled = true; }, () => { settled = true; }); await new Promise(resolve => setTimeout(resolve, 0)); expect(settled).toBe(false); process.emit("close", null); await expect(run.completion).rejects.toMatchObject({ kind: "abort" });
  });

  it("times out and terminates the child", async () => {
    const h = new ProductionCodexBackend({ supportedModels: ["gpt-test"], authenticated: true, available: true, allowedCwdRoots: ["/tmp"], timeoutMs: 1, spawn: () => { const child = new FakeChild(); queueMicrotask(() => child.emit("spawn")); return child as unknown as ChildProcess; } });
    const run = h.execute({ ...task, timeoutMs: 1 }, {}); await expect(run.completion).rejects.toMatchObject({ kind: "timeout" });
  });
});
