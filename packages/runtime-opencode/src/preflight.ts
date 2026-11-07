import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { basename } from "node:path";
import { realpathSync, statSync } from "node:fs";
import type { SpawnFunction } from "./runtime.js";

export interface OpenCodePreflightOptions { readonly command?: string; readonly model?: string; readonly workspaceRoot?: string; readonly timeoutMs?: number; readonly spawn?: SpawnFunction; }
export interface OpenCodePreflightResult { readonly executableFound: boolean; readonly version?: string; readonly versionKnown: boolean; readonly supportedFlagsVerified: boolean; readonly protocolCompatible: boolean; readonly configuredModel?: string; readonly modelExplicit: boolean; readonly workspaceRootValid: boolean; readonly authenticationVerified: false; readonly available: boolean; readonly ready: false; readonly blockers: readonly string[]; readonly source: "read-only-cli-help"; }

const MAX_OUTPUT = 64 * 1024;
const validCommand = (command: string) => basename(command) === "opencode";
const validWorkspace = (root: string | undefined) => { if (!root) return false; try { return statSync(realpathSync(root)).isDirectory(); } catch { return false; } };
const validModel = (model: string | undefined) => typeof model === "string" && /^[^/\s]+\/[^/\s]+$/.test(model) && model !== "*";

async function probe(command: string, args: readonly string[], spawn: SpawnFunction, timeoutMs: number): Promise<{ found: boolean; output: string; exitCode?: number }> {
  return new Promise(resolve => {
    let child: ChildProcess;
    try { child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] } as SpawnOptions); } catch { resolve({ found: false, output: "" }); return; }
    let output = ""; let done = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (found: boolean, exitCode?: number) => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve({ found, output, exitCode }); };
    const collect = (chunk: Buffer | string) => { if (output.length < MAX_OUTPUT) output += String(chunk).slice(0, MAX_OUTPUT - output.length); };
    child.stdout?.on("data", collect); child.stderr?.on("data", collect); child.once("error", () => finish(false)); child.once("close", code => finish(true, code ?? undefined));
    timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* best effort */ } finish(true); }, timeoutMs);
  });
}

export async function preflightOpenCode(options: OpenCodePreflightOptions = {}): Promise<OpenCodePreflightResult> {
  const command = options.command ?? "opencode"; const blockers: string[] = [];
  if (!validCommand(command)) blockers.push("unsafe_command");
  const runner: SpawnFunction = options.spawn ?? ((name, args, spawnOptions) => nodeSpawn(name, args, spawnOptions));
  if (!validCommand(command)) return { executableFound: false, versionKnown: false, supportedFlagsVerified: false, protocolCompatible: false, configuredModel: options.model, modelExplicit: validModel(options.model), workspaceRootValid: validWorkspace(options.workspaceRoot), authenticationVerified: false, available: false, ready: false, blockers, source: "read-only-cli-help" };
  const version = await probe(command, ["--version"], runner, options.timeoutMs ?? 2_000); const help = await probe(command, ["run", "--help"], runner, options.timeoutMs ?? 2_000); const text = help.output;
  const flags = ["--format", "--model", "--dir", "--session"].every(flag => text.includes(flag)); const json = text.includes("json"); const modelOk = validModel(options.model); const workspaceOk = validWorkspace(options.workspaceRoot);
  if (!version.found) blockers.push("executable_not_found"); else if (!version.output.trim()) blockers.push("version_unknown"); if (!help.found || help.exitCode !== 0) blockers.push("help_failed"); if (!flags || !json) blockers.push("required_flags_unverified"); if (!modelOk) blockers.push("model_not_explicit"); if (!workspaceOk) blockers.push("workspace_root_invalid"); blockers.push("authentication_unverified");
  return { executableFound: version.found, version: version.output.trim() || undefined, versionKnown: version.found && Boolean(version.output.trim()), supportedFlagsVerified: flags, protocolCompatible: help.found && help.exitCode === 0 && flags && json, configuredModel: options.model, modelExplicit: modelOk, workspaceRootValid: workspaceOk, authenticationVerified: false, available: version.found && help.exitCode === 0 && flags && json && modelOk && workspaceOk, ready: false, blockers, source: "read-only-cli-help" };
}
