#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import process from "node:process";

export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
}

export interface HttpTransport {
  request<T = unknown>(method: string, path: string, options?: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }): Promise<HttpResponse<T>>;
}

export interface OperatorConfig {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
}

export interface WatchOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  onUpdate?: (body: TaskStatusBody) => void;
}

export interface TaskStatusBody {
  task?: Record<string, unknown>;
  taskId?: string;
  projectId?: string;
  status?: string;
  employeeId?: string;
  runtimeId?: string;
  modelId?: string;
  attempts?: number;
  error?: unknown;
  [key: string]: unknown;
}

export interface ProjectBody {
  id?: string;
  projectId?: string;
  name?: string;
  title?: string;
  status?: string;
  portfolio?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RuntimeReadinessBody {
  runtimeId?: string;
  kind?: string;
  registered?: boolean;
  available?: boolean;
  authenticationVerified?: boolean;
  authentication?: { verified?: boolean };
  blockers?: string[];
  [key: string]: unknown;
}

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const projectPriorities = new Set(["low", "normal", "high", "critical"]);
const projectStatuses = new Set(["active", "paused", "archived"]);

export class OperatorError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "OperatorError";
    this.exitCode = exitCode;
  }
}

function redactedMessage(body: unknown, status: number, secret?: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const code = "code" in error && typeof error.code === "string" ? error.code : "request_failed";
      const message = "message" in error && typeof error.message === "string" ? error.message : "request failed";
      return `${code}: ${message}`.replace(secret ? new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : /$^/g, "[REDACTED]").replace(/(bearer\s+|token|secret|password|api[_-]?key)\s*[:=]?\s*[^\s,;]+/gi, "$1[REDACTED]");
    }
  }
  return `HTTP request failed (${status})`;
}

export class FetchTransport implements HttpTransport {
  constructor(private readonly config: OperatorConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async request<T>(method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const headers: Record<string, string> = { accept: "application/json", ...options.headers };
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(JSON.stringify(options.body)).toString();
    }
    try {
      const response = await this.fetchImpl(new URL(path, this.config.baseUrl), { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: controller.signal });
      const text = await response.text();
      let body: unknown = undefined;
      try { body = text ? JSON.parse(text) : undefined; } catch { body = { error: { code: "invalid_response", message: "server returned invalid JSON" } }; }
      if (!response.ok) throw new OperatorError(redactedMessage(body, response.status, this.config.token), response.status === 401 || response.status >= 500 ? 2 : 1);
      return { status: response.status, body: body as T };
    } catch (error) {
      if (error instanceof OperatorError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new OperatorError("request timed out or was cancelled", 2);
      throw new OperatorError("server unavailable", 2);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

export async function loadOperatorConfig(env: NodeJS.ProcessEnv = process.env): Promise<OperatorConfig> {
  const port = env.MAO_SERVER_PORT || "3333";
  const baseUrl = (env.MAO_SERVER_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "") + "/";
  let token = env.MAO_TOKEN;
  const tokenFile = env.MAO_TOKEN_FILE;
  if (!token && tokenFile) {
    const info = await stat(tokenFile).catch(() => undefined);
    if (!info?.isFile()) throw new OperatorError("MAO_TOKEN_FILE is not a regular file");
    if ((info.mode & 0o077) !== 0) throw new OperatorError("MAO_TOKEN_FILE must be readable only by its owner");
    token = (await readFile(tokenFile, "utf8")).trim();
  }
  if (token === "") token = undefined;
  return { baseUrl, token, timeoutMs: Number(env.MAO_HTTP_TIMEOUT_MS || 10000) || 10000 };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new OperatorError(`${name} requires a value`);
  return value;
}

function requiredOption(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new OperatorError(`${name} is required`);
  return value;
}

function validateId(value: string, name: string): string {
  if (!safeId.test(value)) throw new OperatorError(`invalid ${name}`);
  return value;
}

function printJson(value: unknown, output: (line: string) => void): void { output(JSON.stringify(value, null, 2)); }

function safeDisplay(value: unknown, key = "", depth = 0): unknown {
  if (/^(brief|prompt|raw(?:prompt|result|output)|token|secret|password|credential|api.?key|cookie|authorization)$/i.test(key)) return "[REDACTED]";
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return value.replace(/(bearer\s+|api[_-]?key\s*[:=]\s*|password\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeDisplay(item, key, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, safeDisplay(childValue, childKey, depth + 1)]));
  return value;
}

function printValue(value: unknown, output: (line: string) => void, jsonOutput: boolean, label?: string): void {
  const safe = safeDisplay(value);
  if (jsonOutput) { printJson(safe, output); return; }
  if (label) output(`${label}:`);
  if (typeof safe === "object") printJson(safe, output);
  else output(String(safe));
}

function numberOption(args: string[], name: string, predicate: (value: number) => boolean, description: string): number {
  const raw = requiredOption(args, name);
  const value = Number(raw);
  if (!Number.isFinite(value) || !predicate(value)) throw new OperatorError(`${name} must be ${description}`);
  return value;
}

function projectCreateBody(args: string[]): Record<string, unknown> {
  const id = validateId(requiredOption(args, "--project-id"), "project id");
  const name = option(args, "--name") || option(args, "--title");
  if (!name) throw new OperatorError("--name (or --title) is required");
  const rootDir = requiredOption(args, "--root-dir");
  const status = option(args, "--status") ?? "active";
  const priority = option(args, "--priority") ?? "normal";
  if (!projectStatuses.has(status)) throw new OperatorError("--status must be active, paused or archived");
  if (!projectPriorities.has(priority)) throw new OperatorError("--priority must be low, normal, high or critical");
  const budgetShare = numberOption(args, "--budget-share", (value) => value >= 0 && value <= 1, "between 0 and 1");
  const maxConcurrentExecutions = numberOption(args, "--max-concurrent-executions", Number.isSafeInteger, "a positive integer");
  if (maxConcurrentExecutions < 1) throw new OperatorError("--max-concurrent-executions must be positive");
  return { id, name, rootDir, status, portfolio: { priority, budgetShare, maxConcurrentExecutions } };
}

function taskIdFromResponse(body: unknown): string {
  if (body && typeof body === "object" && "task" in body) {
    const task = (body as { task?: unknown }).task;
    if (task && typeof task === "object" && "id" in task && typeof task.id === "string") return validateId(task.id, "task id");
  }
  throw new OperatorError("server response did not contain a task id");
}

async function fakeRuntimeIsSafe(client: HttpTransport, signal?: AbortSignal): Promise<void> {
  const body = (await client.request<{ runtimes?: RuntimeReadinessBody[] }>("GET", "/v1/runtimes", { signal })).body;
  const runtimes = Array.isArray(body.runtimes) ? body.runtimes : [];
  const fake = runtimes.find((runtime) => runtime.runtimeId === "fake");
  const productionAvailable = runtimes.some((runtime) => runtime.runtimeId !== "fake" && runtime.available === true);
  if (!fake || fake.available !== true || fake.registered === false || productionAvailable) throw new OperatorError("demo requires an available Fake Runtime and no available production Runtime");
}

export async function runFakeDemo(client: HttpTransport, args: string[] = [], options: { output?: (line: string) => void; json?: boolean; signal?: AbortSignal; watch?: (taskId: string, options: WatchOptions) => Promise<TaskStatusBody> } = {}): Promise<Record<string, unknown>> {
  const output = options.output ?? ((line) => console.log(line));
  const jsonOutput = options.json ?? false;
  const health = (await client.request("GET", "/v1/health", { signal: options.signal })).body;
  const status = (await client.request<Record<string, unknown>>("GET", "/v1/status", { signal: options.signal })).body;
  await fakeRuntimeIsSafe(client, options.signal);
  const explicitProject = option(args, "--project-id");
  let project: unknown;
  if (explicitProject) {
    const projectId = validateId(explicitProject, "project id");
    project = (await client.request("GET", `/v1/projects/${projectId}`, { signal: options.signal })).body;
  } else {
    const projectId = `mao-demo-${Date.now()}`;
    project = (await client.request("POST", "/v1/projects", { signal: options.signal, body: { id: projectId, name: "MAO Fake Demo", rootDir: process.cwd(), status: "active", portfolio: { priority: "normal", budgetShare: 0.01, maxConcurrentExecutions: 1 } } })).body;
  }
  const projectId = explicitProject ? validateId(explicitProject, "project id") : String((project as { project?: { id?: string } }).project?.id ?? "");
  if (!safeId.test(projectId)) throw new OperatorError("server response did not contain a demo project id");
  const taskId = `mao-demo-task-${Date.now()}`;
  const submitted = (await client.request("POST", "/v1/tasks", { signal: options.signal, headers: { "idempotency-key": taskId }, body: { id: taskId, projectId, title: "MAO Fake Demo", brief: "Run the local Fake-MVP demonstration", complexity: "simple", priority: "normal" } })).body;
  const actualTaskId = taskIdFromResponse(submitted);
  const watch = options.watch ?? ((id: string, watchOptions: WatchOptions) => watchTask(client, id, watchOptions));
  const terminal = await watch(actualTaskId, { signal: options.signal, onUpdate: (body) => { if (!jsonOutput) output(`task ${body.taskId ?? actualTaskId}: ${body.status ?? "unknown"}`); } });
  let archive: unknown = { enabled: false };
  const archiveConfigured = status && typeof status === "object" && "archive" in status && (status.archive as { configured?: unknown })?.configured === true;
  if (archiveConfigured) archive = (await client.request("GET", `/v1/archive/tasks/${actualTaskId}/history`, { signal: options.signal })).body;
  const result = { health, status, project, task: terminal, archive };
  printValue(result, output, jsonOutput, jsonOutput ? undefined : "demo");
  return result;
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new OperatorError("watch cancelled", 2));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new OperatorError("watch cancelled", 2)); }, { once: true });
  });
}

export async function watchTask(client: HttpTransport, taskId: string, options: WatchOptions = {}): Promise<TaskStatusBody> {
  const intervalMs = Math.max(100, Math.min(options.intervalMs ?? 1000, 60_000));
  const timeoutMs = Math.max(intervalMs, Math.min(options.timeoutMs ?? 60_000, 600_000));
  const started = Date.now();
  const wait = options.sleep ?? sleep;
  let previousStatus: string | undefined;
  while (Date.now() - started <= timeoutMs) {
    if (options.signal?.aborted) throw new OperatorError("watch cancelled", 2);
    const response = await client.request<TaskStatusBody>("GET", `/v1/tasks/${encodeURIComponent(taskId)}`, { signal: options.signal });
    const body = response.body;
    if (options.signal?.aborted) throw new OperatorError("watch cancelled", 2);
    if (body.status !== previousStatus) { previousStatus = body.status; options.onUpdate?.(body); }
    if (body.status && terminalStatuses.has(body.status)) return body;
    await wait(intervalMs, options.signal);
  }
  throw new OperatorError("task watch timed out", 2);
}

export function help(): string {
  return [
    "mao — local Multi-Agent Office operator CLI",
    "",
    "Commands:",
    "  health                                      server health",
    "  status                                      server and budget status",
    "  projects                                   list projects",
    "  project create --project-id ID --name NAME --root-dir PATH --budget-share 0..1 --max-concurrent-executions N [--priority low|normal|high|critical] [--status active|paused|archived]",
    "  project show ID                             project details",
    "  employees                                  list employees",
    "  runtimes                                   runtime readiness",
    "  diagnostics                                execution diagnostics",
    "  events [--task-id ID] [--type TYPE]         event journal",
    "  archive project ID                          archived project",
    "  archive task ID                             archived task history",
    "  archive events PROJECT_ID                   archived project events",
    "  task submit --project-id ID --title TEXT --brief TEXT [--complexity simple|standard|complex] [--priority interactive|normal] [--id ID] [--idempotency-key KEY]",
    "  task status ID                              current task status",
    "  task watch ID [--interval-ms N] [--timeout-ms N]",
    "  task cancel ID                              cancel a task",
    "  demo fake [--project-id ID] [--json]        safe Fake-MVP workflow",
    "  --json                                      machine-readable output",
    "",
    "Configuration: MAO_SERVER_URL (default http://127.0.0.1:3333/),",
    "MAO_TOKEN_FILE (owner-readable file) or MAO_TOKEN, MAO_HTTP_TIMEOUT_MS.",
  ].join("\n");
}

export async function runCli(args: string[], dependencies: { client?: HttpTransport; config?: OperatorConfig; output?: (line: string) => void; error?: (line: string) => void; signal?: AbortSignal } = {}): Promise<number> {
  const output = dependencies.output ?? ((line) => console.log(line));
  const error = dependencies.error ?? ((line) => console.error(line));
  const jsonOutput = args.includes("--json");
  args = args.filter((arg) => arg !== "--json");
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") { output(help()); return 0; }
  const command = args[0];
  try {
    const client = dependencies.client ?? new FetchTransport(dependencies.config ?? await loadOperatorConfig());
    if (["health", "status", "projects", "employees", "runtimes", "diagnostics"].includes(command)) {
      const path = command === "diagnostics" ? "/v1/executions/diagnostics" : `/v1/${command}`;
      printValue((await client.request("GET", path, { signal: dependencies.signal })).body, output, jsonOutput, command); return 0;
    }
    if (command === "events") {
      const params = new URLSearchParams(); for (const [flag, key] of [["--task-id", "taskId"], ["--type", "type"], ["--from", "from"], ["--limit", "limit"]] as const) { const value = option(args, flag); if (value) params.set(key, value); }
      printValue((await client.request("GET", `/v1/events?${params}`, { signal: dependencies.signal })).body, output, jsonOutput, "events"); return 0;
    }
    if (command === "project") {
      const action = args[1];
      if (action === "create") {
        const body = projectCreateBody(args.slice(2));
        printValue((await client.request("POST", "/v1/projects", { body, signal: dependencies.signal })).body, output, jsonOutput, "project"); return 0;
      }
      if (action === "show") {
        const id = validateId(args[2] ?? "", "project id");
        printValue((await client.request("GET", `/v1/projects/${id}`, { signal: dependencies.signal })).body, output, jsonOutput, "project"); return 0;
      }
      throw new OperatorError("project command must be create or show");
    }
    if (command === "archive") {
      const kind = args[1]; const id = validateId(requiredOption(args.slice(2), kind === "events" ? "--project-id" : "--id"), "archive identifier");
      const path = kind === "project" ? `/v1/archive/projects/${id}` : kind === "events" ? `/v1/archive/projects/${id}/events` : kind === "task" ? `/v1/archive/tasks/${id}/history` : (() => { throw new OperatorError("archive command must be project, task or events"); })();
      printValue((await client.request("GET", path, { signal: dependencies.signal })).body, output, jsonOutput, "archive"); return 0;
    }
    if (command === "demo" && args[1] === "fake") { await runFakeDemo(client, args.slice(2), { output, json: jsonOutput, signal: dependencies.signal }); return 0; }
    if (command === "demo") throw new OperatorError("demo command must be fake");
    if (command === "task") {
      const action = args[1];
      if (action === "submit") {
        const rest = args.slice(2); const projectId = validateId(requiredOption(rest, "--project-id"), "project id"); const title = requiredOption(rest, "--title"); const brief = requiredOption(rest, "--brief");
        const body: Record<string, unknown> = { projectId, title, brief }; for (const key of ["id", "complexity", "priority", "estimatedCostUsd", "estimatedTotalTokens", "estimatedOutputTokens"] as const) { const value = option(rest, `--${key}`); if (value !== undefined) { if (key === "complexity" && !["simple", "standard", "complex"].includes(value)) throw new OperatorError("--complexity must be simple, standard or complex"); if (key === "priority" && !["interactive", "normal"].includes(value)) throw new OperatorError("--priority must be interactive or normal"); if (["estimatedCostUsd", "estimatedTotalTokens", "estimatedOutputTokens"].includes(key)) { const numeric = Number(value); if (!Number.isFinite(numeric) || numeric < 0) throw new OperatorError(`--${key} must be a non-negative number`); body[key] = numeric; } else body[key] = value; } }
        const headers: Record<string, string> = {}; const idempotency = option(rest, "--idempotency-key"); if (idempotency) headers["idempotency-key"] = idempotency;
        printValue((await client.request("POST", "/v1/tasks", { body, headers, signal: dependencies.signal })).body, output, jsonOutput, "task"); return 0;
      }
      const id = validateId(args[2] ?? "", "task id");
      if (action === "status") { printValue((await client.request("GET", `/v1/tasks/${id}`, { signal: dependencies.signal })).body, output, jsonOutput, "task"); return 0; }
      if (action === "cancel") { printValue((await client.request("POST", `/v1/tasks/${id}/cancel`, { signal: dependencies.signal })).body, output, jsonOutput, "task"); return 0; }
      if (action === "watch") { const body = await watchTask(client, id, { intervalMs: Number(option(args.slice(3), "--interval-ms") || 1000), timeoutMs: Number(option(args.slice(3), "--timeout-ms") || 60000), signal: dependencies.signal, onUpdate: (value) => { if (!jsonOutput) output(`task ${value.taskId ?? id}: ${value.status ?? "unknown"}`); } }); printValue(body, output, jsonOutput, "task"); if (terminalStatuses.has(String(body.status))) return 0; }
      else throw new OperatorError("task command must be submit, status, watch or cancel");
      return 0;
    }
    throw new OperatorError(`unknown command: ${command}`);
  } catch (caught) {
    const failure = caught instanceof OperatorError ? caught : new OperatorError("command failed");
    error(failure.message); return failure.exitCode;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  void runCli(process.argv.slice(2), { signal: controller.signal }).then((code) => { process.exitCode = code; });
}
