import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { preflightCodex, type CodexSpawn } from "../src/index.js";

class ProbeChild extends EventEmitter { readonly stdout = new EventEmitter(); readonly stderr = new EventEmitter(); kill(): boolean { this.emit("close", 143); return true; } }

function runner(calls: Array<{ args: readonly string[]; shell?: boolean }>): CodexSpawn {
  return ((_, args, options) => { calls.push({ args, shell: typeof options.shell === "boolean" ? options.shell : undefined }); const child = new ProbeChild(); queueMicrotask(() => { if (args[0] === "--version") child.stdout.emit("data", "codex 0.1.0\n"); else child.stdout.emit("data", "exec [OPTIONS] --experimental-json --json --model --sandbox --cd\n"); child.emit("close", 0); }); return child as unknown as ChildProcess; }) as CodexSpawn;
}

describe("Codex safe preflight", () => {
  it("uses only fixed read-only version/help arguments and never authenticates", async () => {
    const calls: Array<{ args: readonly string[]; shell?: boolean }> = [];
    const result = await preflightCodex({ model: "chatgpt-plus/gpt-test", workspaceRoot: "/tmp", spawn: runner(calls) });
    expect(result.executableFound).toBe(true); expect(result.versionKnown).toBe(true); expect(result.protocolCompatible).toBe(true); expect(result.ready).toBe(false); expect(result.authenticationVerified).toBe(false); expect(result.blockers).toContain("authentication_unverified");
    expect(calls.map(call => call.args)).toEqual([["--version"], ["exec", "--help"]]); expect(calls.every(call => call.shell === false)).toBe(true);
  });

  it("reports missing executable and unsafe command without running arbitrary commands", async () => {
    const result = await preflightCodex({ command: "sh -c codex", model: "chatgpt-plus/gpt-test", workspaceRoot: "/tmp", spawn: (() => { throw new Error("must not run"); }) as CodexSpawn });
    expect(result.executableFound).toBe(false); expect(result.blockers).toContain("unsafe_command");
  });
});
