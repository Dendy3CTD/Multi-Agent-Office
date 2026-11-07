import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { preflightOpenCode, type SpawnFunction } from "../src/index.js";

class ProbeChild extends EventEmitter { readonly stdout = new EventEmitter(); readonly stderr = new EventEmitter(); kill(): boolean { this.emit("close", 143); return true; } }

function runner(calls: Array<{ args: readonly string[]; shell?: boolean }>): SpawnFunction {
  return ((_, args, options) => { calls.push({ args, shell: typeof options.shell === "boolean" ? options.shell : undefined }); const child = new ProbeChild(); queueMicrotask(() => { if (args[0] === "--version") child.stdout.emit("data", "opencode 1.19.5\n"); else child.stdout.emit("data", "run [OPTIONS] --format json --model --dir --session --title\n"); child.emit("close", 0); }); return child as unknown as ChildProcess; }) as SpawnFunction;
}

describe("OpenCode safe preflight", () => {
  it("verifies only version/help flags and leaves authentication unverified", async () => {
    const calls: Array<{ args: readonly string[]; shell?: boolean }> = [];
    const result = await preflightOpenCode({ model: "opencode-go/glm-5.3-flash", workspaceRoot: "/tmp", spawn: runner(calls) });
    expect(result.executableFound).toBe(true); expect(result.version).toContain("1.19.5"); expect(result.protocolCompatible).toBe(true); expect(result.ready).toBe(false); expect(result.authenticationVerified).toBe(false); expect(result.blockers).toContain("authentication_unverified");
    expect(calls.map(call => call.args)).toEqual([["--version"], ["run", "--help"]]); expect(calls.every(call => call.shell === false)).toBe(true);
  });

  it("does not run an arbitrary command", async () => {
    const result = await preflightOpenCode({ command: "bash -c opencode", model: "opencode-go/model", workspaceRoot: "/tmp", spawn: (() => { throw new Error("must not run"); }) as SpawnFunction });
    expect(result.executableFound).toBe(false); expect(result.blockers).toContain("unsafe_command");
  });
});
