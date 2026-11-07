import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { createDefaultMaoServer } from "./defaults.js";
import { isLocalHost, listenLocalhost, type MaoServer } from "./http.js";

export interface LocalServerConfiguration {
  readonly host: string;
  readonly port: number;
  readonly tokenFile: string;
}

export interface LocalServerHandle {
  readonly mao: MaoServer;
  readonly address: string;
  readonly configuration: LocalServerConfiguration;
  readonly stop: () => Promise<void>;
}

const defaultTokenFile = () => resolve(homedir(), ".config", "open-agent-office", "token");
const inside = (root: string, candidate: string): boolean => { const rel = relative(root, candidate); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`)); };

export function parseLocalServerConfiguration(env: NodeJS.ProcessEnv = process.env): LocalServerConfiguration {
  const host = env.MAO_HOST ?? "127.0.0.1";
  if (!isLocalHost(host)) throw Object.assign(new Error("MAO_HOST must be localhost-only"), { code: "invalid_host" });
  const rawPort = env.MAO_PORT ?? "3000";
  if (!/^\d+$/.test(rawPort)) throw Object.assign(new Error("MAO_PORT must be an integer"), { code: "invalid_port" });
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw Object.assign(new Error("MAO_PORT is outside the valid range"), { code: "invalid_port" });
  const tokenFile = resolve(env.MAO_TOKEN_FILE ?? defaultTokenFile());
  if (inside(resolve(process.cwd()), tokenFile)) throw Object.assign(new Error("token file must be outside the repository"), { code: "unsafe_token_path" });
  return { host, port, tokenFile };
}

/** Creates a local bearer token without ever returning it to startup logging. */
export async function ensureLocalToken(tokenFile: string): Promise<string> {
  const path = resolve(tokenFile);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const token = (await readFile(path, "utf8")).trim();
    if (!token) throw Object.assign(new Error("token file is empty"), { code: "invalid_token_file" });
    await chmod(path, 0o600);
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const token = randomBytes(32).toString("base64url");
    try { await writeFile(path, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); return token; }
    catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
      const existing = (await readFile(path, "utf8")).trim();
      if (!existing) throw Object.assign(new Error("token file is empty"), { code: "invalid_token_file" });
      await chmod(path, 0o600);
      return existing;
    }
  }
}

function safeStartupError(error: unknown): string { const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "startup_failed"; return code.replace(/[^a-z0-9_.-]/gi, "_"); }

export async function startLocalServer(env: NodeJS.ProcessEnv = process.env, output: Pick<Console, "log" | "error"> = console): Promise<LocalServerHandle> {
  const configuration = parseLocalServerConfiguration(env);
  const token = await ensureLocalToken(configuration.tokenFile);
  const mao = await createDefaultMaoServer({ token });
  let boundAddress = "";
  try {
    const address = await listenLocalhost(mao.server, configuration.port, configuration.host);
    boundAddress = address;
    const runtimeCount = mao.app.options.runtimeManager.list().length;
    const productionCount = mao.app.options.runtimeManager.list().filter(runtime => !String(runtime.runtimeId).includes("fake")).length;
    const delivery = mao.app.options.deliveryDiagnostics?.();
    const blockers = (mao.app.options.runtimeReadiness ?? []).flatMap(entry => entry.blockers).slice(0, 12);
    output.log(`[MAO] listening on http://${configuration.host}:${address.split(":").pop()}`);
    output.log(`[MAO] runtimes=${runtimeCount} mode=${productionCount === 0 ? "fake-default" : "production-enabled"}`);
    output.log(`[MAO] archive=${mao.app.options.archive ? "enabled" : "disabled"} journal=${delivery ? (delivery.journalHealthy ? "healthy" : "blocked") : "disabled"}`);
    output.log(`[MAO] readiness_blockers=${blockers.length > 0 ? blockers.join(",") : "none"}`);
  } catch (error) {
    await mao.close().catch(() => undefined);
    throw error;
  }
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => { if (stopping) return stopping; stopping = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { mao.server.closeAllConnections?.(); reject(Object.assign(new Error("shutdown timeout"), { code: "shutdown_timeout" })); }, 5_000); void mao.close().then(() => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); }); }); return stopping; };
  return { mao, address: boundAddress, configuration, stop };
}

export async function main(): Promise<void> {
  try {
    const handle = await startLocalServer();
    let stopping = false;
    const shutdown = (signal: string) => { if (stopping) return; stopping = true; void handle.stop().then(() => { console.log(`[MAO] stopped (${signal})`); }).catch(error => { console.error(`[MAO] shutdown failed (${safeStartupError(error)})`); process.exitCode = 1; }); };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error(`[MAO] startup failed (${safeStartupError(error)})`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
