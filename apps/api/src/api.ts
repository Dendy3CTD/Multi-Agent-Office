import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { realpath, mkdir } from "node:fs/promises";
import type { AgentEvent, RuntimeAdapter, RuntimeExecutionInput } from "@mao-hybrid/contracts";
import { createCompany, createDefaultRoster, type Company, type CompanyRoster, type RuntimeExecutionResult, type RuntimePort } from "@mao-hybrid/company";
import { SqliteTaskStore, type SqliteTaskStore as SqliteTaskStoreType } from "@mao-hybrid/task-store";
import { createEventBus, type EventBus } from "@mao-hybrid/events";
import { listTools } from "@mao-hybrid/contracts";

export interface ApiConfig {
  readonly host?: string;
  readonly port?: number;
  readonly dataDirectory: string;
  readonly maxConcurrent?: 1 | 2;
}
export interface ApiRuntime extends RuntimeAdapter { available(): boolean; }
export interface ApiServer {
  readonly company: Company;
  readonly store: SqliteTaskStoreType;
  readonly events: EventBus;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

export async function createApiServer(options: { config: ApiConfig; runtime: ApiRuntime; roster?: CompanyRoster; events?: EventBus }): Promise<ApiServer> {
  const host = options.config.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") throw new TypeError("API may only bind to loopback");
  const port = options.config.port ?? 8765;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError("API port is invalid");
  const maxConcurrent = options.config.maxConcurrent ?? 2;
  if (maxConcurrent !== 1 && maxConcurrent !== 2) throw new TypeError("maxConcurrent must be one or two");
  const dataDirectory = await mkdir(options.config.dataDirectory, { recursive: true }).then(() => realpath(options.config.dataDirectory));
  const store = new SqliteTaskStore({ filename: dataDirectory + "/tasks.sqlite", maxConcurrent });
  const events = options.events ?? createEventBus();
  const runtimePort = adaptRuntimePort(options.runtime);
  const roster = options.roster ?? createDefaultRoster();
  const company = createCompany({ store, runtime: runtimePort, roster, maxConcurrent });
  await company.resume();
  const server = createServer((request, response) => {
    void handle(request, response).catch(error => {
      const status = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "request_failed";
      sendJson(response, status, { error: { code, message: status >= 500 ? "Request failed" : code } });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://" + host);
    if (request.method === "GET" && url.pathname === "/health") return sendJson(response, 200, { status: "ok" });
    if (request.method === "GET" && url.pathname === "/api/status") {
      const tasks = store.listTasks();
      const active = tasks.reduce((count, task) => count + task.steps.filter(step => step.status === "running").length, 0);
      return sendJson(response, 200, { status: "ok", runtimeAvailable: options.runtime.available(), projectCount: store.listProjects().length, taskCount: tasks.length, activeExecutions: active, maxConcurrent });
    }
    if (request.method === "GET" && url.pathname === "/api/tools") return sendJson(response, 200, { tools: listTools() });
    if (request.method === "GET" && url.pathname === "/api/projects") return sendJson(response, 200, { projects: store.listProjects() });
    if (request.method === "POST" && url.pathname === "/api/projects") {
      const body = await readJson(request);
      if (!isString(body.id) || !isString(body.name) || !isString(body.workspaceRoot)) return sendJson(response, 400, error("invalid_project", "id, name and workspaceRoot are required"));
      const workspaceRoot = await realpath(body.workspaceRoot).catch(() => undefined);
      if (!workspaceRoot) return sendJson(response, 400, error("workspace_unavailable", "Project workspace must exist"));
      try { return sendJson(response, 201, { project: company.registerProject({ id: body.id, name: body.name, workspaceRoot }) }); }
      catch (cause) { return sendJson(response, 400, error(safeCode(cause, "invalid_project"), "Project could not be registered")); }
    }
    if (request.method === "GET" && url.pathname === "/api/employees") return sendJson(response, 200, { employees: roster.employees });
    if (request.method === "GET" && url.pathname === "/api/tasks") return sendJson(response, 200, { tasks: store.listTasks() });
    const taskMatch = /^\/api\/tasks\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === "GET" && taskMatch) {
      const task = company.getTask(taskMatch[1]!);
      return task ? sendJson(response, 200, task) : sendJson(response, 404, error("task_not_found", "Task not found"));
    }
    const eventMatch = /^\/api\/tasks\/([A-Za-z0-9_-]+)\/events$/.exec(url.pathname);
    if (request.method === "GET" && eventMatch) {
      const task = company.getTask(eventMatch[1]!);
      if (!task) return sendJson(response, 404, error("task_not_found", "Task not found"));
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
      const lastId = Number(request.headers["last-event-id"] ?? 0);
      for (const event of events.list(task.task.id)) if (event.id > lastId) writeEvent(response, event);
      if (task.task.status === "completed" || task.task.status === "failed" || task.task.status === "needs_review") response.end();
      else {
        const unsubscribe = events.subscribe(task.task.id, event => writeEvent(response, event));
        request.on("close", unsubscribe);
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/tasks") {
      if (!options.runtime.available()) return sendJson(response, 503, error("runtime_unavailable", "Codex Runtime is unavailable"));
      const body = await readJson(request);
      if (!isString(body.projectId) || !isString(body.title) || !isString(body.brief)) return sendJson(response, 400, error("invalid_task", "projectId, title and brief are required"));
      const idempotencyKey = request.headers["idempotency-key"];
      if (Array.isArray(idempotencyKey) || idempotencyKey !== undefined && (idempotencyKey.length < 1 || idempotencyKey.length > 200)) return sendJson(response, 400, error("invalid_idempotency_key", "Idempotency-Key must be one value up to 200 characters"));
      try {
        const result = await company.submitAndRun({
          projectId: body.projectId,
          title: body.title,
          brief: body.brief,
          ...(body.priority === "interactive" || body.priority === "normal" ? { priority: body.priority } : {}),
          ...(body.complexity === "simple" || body.complexity === "standard" || body.complexity === "complex" ? { complexity: body.complexity } : {}),
          ...(Array.isArray(body.acceptanceCriteria) && body.acceptanceCriteria.every(isString) ? { acceptanceCriteria: body.acceptanceCriteria } : {}),
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });
        return sendJson(response, 200, result);
      } catch (cause) {
        const code = safeCode(cause, "task_submission_failed");
        const status = code === "project_not_found" ? 404 : code === "idempotency_conflict" ? 409 : 400;
        return sendJson(response, status, error(code, "Task could not be submitted"));
      }
    }
    sendJson(response, 404, error("not_found", "Endpoint not found"));
  }

  return {
    company, store, events,
    listen: () => new Promise((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("API listener address unavailable"));
        resolveListen({ host, port: address.port });
      });
    }),
    close: async () => {
      if (server.listening) await new Promise<void>((resolveClose, reject) => server.close(cause => cause ? reject(cause) : resolveClose()));
      store.close();
    },
  };
}

function adaptRuntimePort(runtime: RuntimeAdapter): RuntimePort {
  return {
    execute: input => runtime.execute(input as unknown as RuntimeExecutionInput),
    ...(runtime.inspect ? { inspect: async input => {
      const result = await runtime.inspect!(input as unknown as Pick<RuntimeExecutionInput, "executionId" | "task" | "step" | "project">);
      // Company v0's declaration omits its implemented "running" inspection result.
      return result as unknown as RuntimeExecutionResult;
    } } : {}),
  };
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw Object.assign(new Error("body_too_large"), { statusCode: 413, code: "body_too_large" });
    chunks.push(buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("invalid_json"), { statusCode: 400, code: "invalid_json" }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("invalid_json"), { statusCode: 400, code: "invalid_json" });
  return value as Record<string, unknown>;
}
function writeEvent(response: ServerResponse, event: AgentEvent): void { response.write("id: " + event.id + "\nevent: " + event.type + "\ndata: " + JSON.stringify(event) + "\n\n"); }
function sendJson(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
function error(code: string, message: string) { return { error: { code, message } }; }
function isString(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 100_000 && !value.includes("\0"); }
function safeCode(error: unknown, fallback: string): string { return error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[a-z][a-z0-9_.-]{0,63}$/.test(error.code) ? error.code : fallback; }
