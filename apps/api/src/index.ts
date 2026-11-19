import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createEventBus } from "@mao-hybrid/events";
import { createCodexRuntime, type CodexSandbox } from "@mao-hybrid/runtime";
import { createApiServer, type ApiConfig } from "./api.js";

interface Config extends ApiConfig {
  readonly codexPath?: string;
  readonly sandbox?: CodexSandbox;
  readonly model?: string;
}

async function loadConfig(): Promise<Config> {
  const configPath = resolve(process.env.MAO_HYBRID_CONFIG ?? "mao-hybrid.config.json");
  let value: unknown;
  try { value = JSON.parse(await readFile(configPath, "utf8")); }
  catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
      return { dataDirectory: resolve("data") };
    }
    throw new Error("Could not read MAO Hybrid configuration");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Configuration must be a JSON object");
  const config = value as Record<string, unknown>;
  const allowed = new Set(["host", "port", "dataDirectory", "maxConcurrent", "codexPath", "sandbox", "model"]);
  if (Object.keys(config).some(key => !allowed.has(key))) throw new Error("Configuration contains an unsupported property");
  if (typeof config.dataDirectory !== "string" || config.dataDirectory.length === 0) throw new Error("dataDirectory is required");
  if (config.host !== undefined && typeof config.host !== "string") throw new Error("host is invalid");
  if (config.port !== undefined && (!Number.isSafeInteger(config.port) || Number(config.port) < 0 || Number(config.port) > 65535)) throw new Error("port is invalid");
  if (config.maxConcurrent !== undefined && config.maxConcurrent !== 1 && config.maxConcurrent !== 2) throw new Error("maxConcurrent must be one or two");
  if (config.codexPath !== undefined && (typeof config.codexPath !== "string" || config.codexPath.length === 0)) throw new Error("codexPath is invalid");
  if (config.sandbox !== undefined && config.sandbox !== "read-only" && config.sandbox !== "workspace-write") throw new Error("sandbox is invalid");
  if (config.model !== undefined && typeof config.model !== "string") throw new Error("model is invalid");
  return config as unknown as Config;
}

const config = await loadConfig();
const events = createEventBus();
const runtime = createCodexRuntime({
  executable: config.codexPath ?? "codex",
  sandbox: config.sandbox ?? "workspace-write",
  ...(typeof config.model === "string" ? { model: config.model } : {}),
  events,
});
const api = await createApiServer({ config, runtime, events });
const address = await api.listen();
console.log("MAO Hybrid API listening at http://" + address.host + ":" + address.port);

const shutdown = () => { void api.close().finally(() => process.exit(0)); };
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

export { createApiServer } from "./api.js";
