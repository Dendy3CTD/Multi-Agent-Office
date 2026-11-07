import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Archive, ArchiveEvent } from "@open-agent-office/archive";
import type { DeliveryJournalDiagnostics } from "./delivery-journal.js";
import type { DeliveryJournal } from "./delivery-journal.js";
import type { BudgetManager } from "@open-agent-office/budget-manager";
import type { ModelDescriptor, RuntimeCapabilities, Task, TaskStatus } from "@open-agent-office/shared";
import type { OrganizationDirectory } from "@open-agent-office/directory";
import type { ExecutionCoordinator, ExecutionOutcome, ExecutionSnapshot, ProjectPortfolio, RuntimeManager, TaskScheduler } from "@open-agent-office/orchestrator";
import type { RuntimeReadinessSnapshot } from "./runtime-config.js";

export interface ServerOptions { readonly token?: string; readonly directory: OrganizationDirectory; readonly portfolio: ProjectPortfolio; readonly scheduler: TaskScheduler; readonly coordinator?: ExecutionCoordinator; readonly runtimeManager: RuntimeManager; readonly budget: BudgetManager; readonly models: readonly ModelDescriptor[]; readonly runtimeReadiness?: readonly RuntimeReadinessSnapshot[]; readonly archive?: Archive; readonly archiveErrors?: () => readonly string[]; readonly deliveryJournal?: DeliveryJournal; readonly deliveryDiagnostics?: () => DeliveryJournalDiagnostics; readonly version?: string; readonly maxBodyBytes?: number; }
interface EventRecord { readonly type: string; readonly timestamp: string; readonly projectId?: string; readonly taskId?: string; readonly employeeId?: string; readonly payload?: Readonly<Record<string, unknown>>; }
interface TaskRecord { task: Task; readonly projectId: string; result?: unknown; error?: unknown; execution?: Promise<ExecutionOutcome>; }
interface IdempotentResult { readonly status: number; readonly body: unknown; readonly bodyHash: string; readonly expiresAt: number; }
export interface MaoServer { readonly server: Server; readonly app: ServerApplication; readonly close: () => Promise<void>; }

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const bearerPattern = /^bearer\s+(.+)$/i;
const json = (value: unknown): string => JSON.stringify(value);
const clone = <T>(value: T): T => structuredClone(value);
const safeError = (code: string, message: string) => ({ error: { code, message } });
const validPriority = (value: unknown): value is "interactive" | "normal" => value === undefined || value === "interactive" || value === "normal";
const bodyHash = (value: unknown): string => createHash("sha256").update(json(value)).digest("hex");

export class ServerApplication {
  private readonly startedAt = Date.now(); private readonly tasks = new Map<string, TaskRecord>(); private readonly events: EventRecord[] = []; private readonly idempotency = new Map<string, IdempotentResult>();
  /** POST /v1/tasks creations are serialized so identical keys cannot race. */
  private taskCreationQueue: Promise<unknown> = Promise.resolve();
  constructor(readonly options: ServerOptions) {}
  async dispatch(request: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const method = request.method ?? "GET"; const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (method === "OPTIONS") return { status: 204, body: null };
    if (!this.authorized(request)) return { status: 401, body: safeError("unauthorized", "authorization required") };
    try {
      if (method === "GET" && url.pathname === "/v1/health") return { status: 200, body: { status: "ok", version: this.options.version ?? "0.1.0", uptimeMs: Date.now() - this.startedAt } };
      if (method === "GET" && url.pathname === "/v1/status") return { status: 200, body: await this.status() };
      if (method === "GET" && url.pathname === "/v1/departments") return { status: 200, body: { departments: this.options.directory.departments.list() } };
      if (method === "GET" && url.pathname === "/v1/professions") return { status: 200, body: { professions: this.options.directory.professions.list() } };
      if (method === "GET" && url.pathname === "/v1/employees") return { status: 200, body: { employees: this.employees(url.searchParams) } };
      if (method === "GET" && url.pathname.startsWith("/v1/employees/")) return this.employee(url.pathname.slice("/v1/employees/".length));
      if (method === "GET" && url.pathname === "/v1/projects") return { status: 200, body: { projects: this.options.portfolio.list().map(x => x.project) } };
      if (method === "POST" && url.pathname === "/v1/projects") return await this.createProject(request);
      if (method === "GET" && url.pathname.startsWith("/v1/projects/")) return this.project(url.pathname.slice("/v1/projects/".length), url.searchParams);
      if (method === "GET" && url.pathname.startsWith("/v1/archive/")) return await this.archiveRoute(url.pathname.slice("/v1/archive/".length), url.searchParams);
      if (method === "GET" && url.pathname === "/v1/runtimes") return { status: 200, body: { runtimes: this.runtimeReadiness() } };
      if (method === "GET" && url.pathname === "/v1/models") return { status: 200, body: { models: clone(this.options.models) } };
      if (method === "GET" && url.pathname === "/v1/budget/snapshot") return { status: 200, body: await this.options.budget.getSnapshot() };
      if (method === "GET" && url.pathname === "/v1/usage/models") return await this.usageByModel();
      if (method === "GET" && url.pathname === "/v1/events") return this.listEvents(url.searchParams);
      if (method === "GET" && url.pathname === "/v1/executions/diagnostics") return this.executionsDiagnostics();
      if (method === "POST" && url.pathname === "/v1/tasks") return await this.createTask(request);
      const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)(?:\/(cancel))?$/); if (method === "GET" && taskMatch) return this.task(taskMatch[1]); if (method === "POST" && taskMatch?.[2] === "cancel") return this.cancelTask(taskMatch[1]);
      return { status: 404, body: safeError("not_found", "resource not found") };
    } catch (error) { return this.handleError(error); }
  }
  /** Scheme is compared case-insensitively (RFC 7235); the token itself is exact. */
  private authorized(request: IncomingMessage): boolean {
    if (!this.options.token) return true;
    const header = request.headers.authorization;
    if (typeof header !== "string") return false;
    const match = bearerPattern.exec(header);
    if (!match) return false;
    const supplied = Buffer.from(match[1], "utf8");
    const expected = Buffer.from(this.options.token, "utf8");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  private employees(params: URLSearchParams): unknown[] { return this.options.directory.employees.list({ professionId: params.get("professionId") ?? undefined, status: params.get("status") ?? undefined }).map(employee => { const profession = this.options.directory.professions.get(employee.professionId); return { ...employee, departmentId: profession.departmentId, capabilities: profession.capabilityRequirements, skillReferences: [...profession.skillTags, ...employee.skillOverrides], availableSkillIds: [], unresolvedSkillIds: [...profession.skillTags, ...employee.skillOverrides] }; }); }
  private employee(id: string): { status: number; body: unknown } { if (!idPattern.test(id)) return { status: 400, body: safeError("invalid_id", "invalid employee id") }; try { const employee = this.options.directory.employees.get(id); const profession = this.options.directory.professions.get(employee.professionId); return { status: 200, body: { employee: { ...employee, departmentId: profession.departmentId, capabilities: profession.capabilityRequirements, skillReferences: [...profession.skillTags, ...employee.skillOverrides], availableSkillIds: [], unresolvedSkillIds: [...profession.skillTags, ...employee.skillOverrides] } } }; } catch { return { status: 404, body: safeError("not_found", "employee not found") }; } }
  private project(id: string, params: URLSearchParams): { status: number; body: unknown } { try { const project = this.options.portfolio.get(id); const entry = this.options.portfolio.list().find(x => x.project.id === id)!; const tasks = [...this.tasks.values()].filter(x => x.projectId === id).map(x => x.task); return { status: 200, body: { project, status: entry.status, activeTaskCount: entry.activeTaskCount, tasks: params.get("includeTasks") === "false" ? undefined : tasks } }; } catch { return { status: 404, body: safeError("not_found", "project not found") }; } }
  private async createProject(request: IncomingMessage): Promise<{ status: number; body: unknown }> { const contentType = await this.requireJson(request); if (contentType) return contentType; const value = await this.body(request); if (!value || typeof value !== "object") return { status: 422, body: safeError("validation_error", "JSON object body is required") }; const raw = value as Record<string, unknown>; if (typeof raw.id !== "string" || typeof raw.name !== "string" || typeof raw.rootDir !== "string" || !raw.portfolio || typeof raw.portfolio !== "object") return { status: 422, body: safeError("validation_error", "id, name, rootDir and portfolio are required") }; try { this.options.portfolio.register(raw as never); const project = this.options.portfolio.get(raw.id); if (this.options.archive) { try { const now = new Date().toISOString(); await this.options.archive.createProject({ projectId: project.id, title: project.name, status: project.status, createdAt: now, updatedAt: now }); } catch { return { status: 503, body: safeError("archive_unavailable", "project was not durably archived") }; } } return { status: 201, body: { project } }; } catch (error) { return { status: 422, body: safeError("validation_error", error instanceof Error ? error.message : "invalid project") }; } }

  private async createTask(request: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const contentType = await this.requireJson(request);
    if (contentType) return contentType;
    const key = typeof request.headers["idempotency-key"] === "string" ? (request.headers["idempotency-key"] as string) : undefined;
    if (typeof key === "string" && key.length > 128) return { status: 422, body: safeError("validation_error", "Idempotency-Key is too long") };
    const value = await this.body(request);
    if (!value || typeof value !== "object") return { status: 422, body: safeError("validation_error", "JSON object body is required") };
    const raw = value as Record<string, unknown>;
    if (typeof raw.projectId !== "string" || !idPattern.test(raw.projectId) || typeof raw.title !== "string" || typeof raw.brief !== "string" || !validPriority(raw.priority)) return { status: 422, body: safeError("validation_error", "projectId, title, brief and valid priority are required") };
    const payload = raw as { projectId: string; title: string; brief: string; priority?: "interactive" | "normal"; id?: string; complexity?: string; estimatedCostUsd?: number; estimatedTotalTokens?: number; estimatedOutputTokens?: number };
    const run = (): Promise<{ status: number; body: unknown }> => this.admitTask(payload, key);
    if (typeof key !== "string") return run();
    const queued = this.taskCreationQueue.then(run, run);
    // Keep the queue alive even if a single creation fails unexpectedly.
    this.taskCreationQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async admitTask(raw: { projectId: string; title: string; brief: string; priority?: "interactive" | "normal"; id?: string; complexity?: string; estimatedCostUsd?: number; estimatedTotalTokens?: number; estimatedOutputTokens?: number }, key: string | undefined): Promise<{ status: number; body: unknown }> {
    const hash = bodyHash(raw);
    if (key !== undefined) {
      const cached = this.idempotency.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        if (cached.bodyHash !== hash) return { status: 409, body: safeError("idempotency_conflict", "Idempotency-Key was already used with a different payload") };
        return { status: cached.status, body: cached.body };
      }
    }
    try { this.options.portfolio.get(raw.projectId); } catch { return { status: 422, body: safeError("validation_error", "unknown projectId") }; }
    const id = typeof raw.id === "string" ? raw.id : `task-${Date.now()}-${this.tasks.size + 1}`;
    if (!idPattern.test(id) || this.tasks.has(id)) return { status: 422, body: safeError("validation_error", "invalid or duplicate task id") };
    const timestamp = new Date().toISOString();
    const task: Task = { id, projectId: raw.projectId, title: raw.title, brief: raw.brief, complexity: raw.complexity === "complex" || raw.complexity === "simple" ? (raw.complexity as Task["complexity"]) : "standard", status: "planned", priority: raw.priority === "interactive" ? "interactive" : "normal", acceptanceCriteria: [], createdBy: "user", createdAt: timestamp, updatedAt: timestamp };
    if (this.options.archive) { try { await this.options.archive.upsertTask({ taskId: id, projectId: raw.projectId, title: raw.title, status: "queued", createdAt: timestamp, updatedAt: timestamp }); } catch { return { status: 503, body: safeError("archive_unavailable", "task was not durably archived") }; } }
    if (!this.options.coordinator) { try { this.options.scheduler.enqueue({ taskId: id, projectId: raw.projectId, priority: task.priority }); } catch (error) { if (error instanceof TypeError) return { status: 422, body: safeError("validation_error", "task cannot be scheduled in this project") }; return { status: 429, body: { ...safeError("scheduler_unavailable", "task could not be queued"), retryAfter: 1 } }; } }
    this.tasks.set(id, { task, projectId: raw.projectId });
    this.emit({ type: "task_queued", timestamp, projectId: raw.projectId, taskId: id });
    if (this.options.coordinator) this.startExecution(id, raw);
    const result = { status: 202, body: { task } };
    if (key !== undefined) this.idempotency.set(key, { ...result, bodyHash: hash, expiresAt: Date.now() + 86_400_000 });
    return result;
  }

  private startExecution(id: string, raw: { projectId: string; title: string; brief: string; priority?: "interactive" | "normal"; complexity?: string; estimatedCostUsd?: number; estimatedTotalTokens?: number; estimatedOutputTokens?: number }): void { const record = this.tasks.get(id); const coordinator = this.options.coordinator; if (!record || !coordinator) return; try { const project = this.options.portfolio.get(raw.projectId); coordinator.dispatch({ taskId: id, projectId: raw.projectId, title: raw.title, prompt: raw.brief, cwd: project.rootDir, complexity: raw.complexity === "complex" || raw.complexity === "simple" ? raw.complexity : "standard", estimatedInputTokens: Math.max(1, raw.brief.length), estimatedOutputTokens: raw.estimatedOutputTokens ?? 256, estimatedCostUsd: raw.estimatedCostUsd, estimatedTotalTokens: raw.estimatedTotalTokens, maxAttempts: 2 }); coordinator.pump(); const completion = coordinator.completion(id); record.execution = completion; void completion.then(outcome => { record.result = outcome.result; const snapshot = outcome.snapshot; const status: TaskStatus = outcome.phase === "completed" ? "completed" : outcome.phase === "cancelled" ? "cancelled" : outcome.phase === "failed" ? "failed" : "planned"; record.task = { ...record.task, status, updatedAt: new Date().toISOString() }; if (snapshot.error) record.error = snapshot.error; void this.persistTask(record).catch(() => undefined); }).catch(error => { record.task = { ...record.task, status: "failed", updatedAt: new Date().toISOString() }; record.error = { code: "execution_failed", message: error instanceof Error ? error.message : "execution failed" }; void this.persistTask(record).catch(() => undefined); }); } catch (error) { record.task = { ...record.task, status: "failed", updatedAt: new Date().toISOString() }; record.error = { code: "dispatch_failed", message: error instanceof Error ? error.message : "task dispatch failed" }; void this.persistTask(record).catch(() => undefined); } }
  private async persistTask(record: TaskRecord): Promise<void> { if (!this.options.archive) return; const execution = this.options.coordinator?.snapshot(record.task.id); const result = record.result as { readonly text?: string; readonly runtimeId?: string } | undefined; await this.options.archive.upsertTask({ taskId: record.task.id, projectId: record.projectId, title: record.task.title, status: execution?.phase ?? record.task.status, createdAt: record.task.createdAt, updatedAt: record.task.updatedAt, employeeId: execution?.employeeId, runtimeId: execution?.selection?.runtimeId ?? result?.runtimeId, modelId: execution?.selection?.modelId, attempts: execution?.attempt ?? 0, resultAvailable: result !== undefined, resultTextLength: typeof result?.text === "string" ? result.text.length : undefined, errorCode: record.error && typeof record.error === "object" && "code" in record.error ? String((record.error as { code: unknown }).code) : undefined }); }
  private task(id: string): { status: number; body: unknown } { const record = this.tasks.get(id); if (!record) return { status: 404, body: safeError("not_found", "task not found") }; const execution = this.options.coordinator?.snapshot(id); return { status: 200, body: { task: clone(record.task), taskId: id, projectId: record.projectId, status: execution?.phase ?? record.task.status, employeeId: execution?.employeeId, runtimeId: execution?.selection?.runtimeId, modelId: execution?.selection?.modelId, attempts: execution?.attempt ?? 0, result: record.result ?? execution?.result, error: record.error ?? execution?.error, subtasks: [] } }; }
  private cancelTask(id: string): { status: number; body: unknown } { const record = this.tasks.get(id); if (!record) return { status: 404, body: safeError("not_found", "task not found") }; if (this.options.coordinator) { if (!this.options.coordinator.cancel(id)) return { status: 409, body: safeError("invalid_state", "task is no longer cancellable") }; return { status: 200, body: { cancelled: true } }; } const cancelled = this.options.scheduler.cancel(id); if (!cancelled) return { status: 409, body: safeError("invalid_state", "task is no longer waiting") }; const timestamp = new Date().toISOString(); record.task = { ...record.task, status: "cancelled", updatedAt: timestamp }; this.emit({ type: "task_cancelled", timestamp, projectId: record.projectId, taskId: id }); return { status: 200, body: { cancelled: true } }; }
  private async status(): Promise<unknown> { const snapshot = await this.options.budget.getSnapshot(); return { status: "ok", projects: this.options.portfolio.list().length, queuedTasks: this.options.scheduler.pending().length, runtimes: this.options.runtimeManager.list().length, archive: { configured: this.options.archive !== undefined, errors: this.options.archiveErrors?.() ?? [], delivery: this.options.deliveryDiagnostics?.() }, budget: { status: snapshot.status, allowanceStatus: snapshot.allowanceStatus, subscription: snapshot.subscriptionUsage?.status ?? "unknown" } }; }
  private async usageByModel(): Promise<{ status: number; body: unknown }> { const summary = await this.options.budget.getUsageSummary(); const stats = Object.entries(summary.byModel).map(([modelId, totals]) => ({ modelId, attempts: totals.eventCount, successes: 0, successRate: undefined, totalTokens: totals.total, costUsd: totals.costUsd })).sort((a,b)=>a.modelId.localeCompare(b.modelId)); return { status: 200, body: { stats, totals: summary } }; }

  private async archiveRoute(path: string, params: URLSearchParams): Promise<{ status: number; body: unknown }> {
    const archive = this.options.archive;
    if (!archive) return { status: 503, body: safeError("archive_unavailable", "archive is not configured") };
    const parts = path.split("/").filter(Boolean).map(value => { try { return decodeURIComponent(value); } catch { return ""; } });
    if (parts.some(value => !idPattern.test(value))) return { status: 400, body: safeError("invalid_id", "invalid archive identifier") };
    try {
      if (parts.length === 2 && parts[0] === "projects") {
        const project = await archive.getProject(parts[1]);
        return project ? { status: 200, body: { project } } : { status: 404, body: safeError("not_found", "archived project not found") };
      }
      if (parts.length === 3 && parts[0] === "projects" && parts[2] === "events") return { status: 200, body: { events: (await archive.getProjectEvents(parts[1])).slice(-this.archiveLimit(params)) } };
      if ((parts.length === 3 && parts[0] === "tasks" && parts[2] === "history") || (parts.length === 5 && parts[0] === "projects" && parts[2] === "tasks" && parts[4] === "history")) {
        const taskId = parts.length === 3 ? parts[1] : parts[3];
        const recent = await archive.getRecent(1000);
        const task = recent.find(value => typeof value === "object" && value !== null && "taskId" in value && (value as { taskId?: unknown }).taskId === taskId);
        const projectId = parts.length === 5 ? parts[1] : task && "projectId" in task && typeof (task as { projectId?: unknown }).projectId === "string" ? (task as { projectId: string }).projectId : undefined;
        if (!projectId) return { status: 404, body: safeError("not_found", "archived task not found") };
        return { status: 200, body: { events: (await archive.getTaskHistory(projectId, taskId)).slice(-this.archiveLimit(params)) } };
      }
    } catch { return { status: 503, body: safeError("archive_unavailable", "archive could not be read") }; }
    return { status: 404, body: safeError("not_found", "archive resource not found") };
  }
  private archiveLimit(params: URLSearchParams): number { const raw = params.get("limit"); if (!raw || !/^\d+$/.test(raw)) return 100; return Math.max(1, Math.min(Number(raw), 100)); }

  private listEvents(params: URLSearchParams): { status: number; body: unknown } {
    const taskId = params.get("taskId"); const type = params.get("type"); const from = params.get("from"); const rawLimit = params.get("limit");
    if (from !== null && Number.isNaN(Date.parse(from))) return { status: 422, body: safeError("validation_error", "from must be an ISO timestamp") };
    let limit = 100;
    if (rawLimit !== null) { if (!/^\d+$/.test(rawLimit)) return { status: 422, body: safeError("validation_error", "limit must be a non-negative integer") }; limit = Math.max(1, Math.min(Number(rawLimit), 100)); }
    const executionEvents = this.options.coordinator?.listEvents().map(event => ({ type: event.type, timestamp: event.timestamp, projectId: event.projectId, taskId: event.taskId, employeeId: event.employeeId, payload: { attempt: event.attempt, modelId: event.modelId, runtimeId: event.runtimeId, reason: event.reason } })) ?? [];
    const matches = [...this.events, ...executionEvents].filter(event => (!taskId || event.taskId === taskId) && (!type || event.type === type) && (!(from !== null) || Date.parse(event.timestamp) >= Date.parse(from as string))).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    // Deterministic order: chronological, capped by the demand for the last N.
    return { status: 200, body: { events: matches.slice(-limit) } };
  }

  /**
   * Read-only execution diagnostics (MAO-CORE-17): aggregate waiting/active/incomplete
   * states with identifiers, phases and typed errors only. Prompts, cwd and runtime
   * payloads never enter the response (ExecutionCoordinator.diagnostics is the source).
   */
  private executionsDiagnostics(): { status: number; body: unknown } {
    const coordinator = this.options.coordinator;
    if (!coordinator) return { status: 503, body: safeError("coordinator_unavailable", "execution coordinator is not configured for this server") };
    try {
      const snapshot = coordinator.diagnostics();
      const sanitized = snapshot.entries.map(entry => ({ taskId: entry.taskId, projectId: entry.projectId, phase: entry.phase, attempt: entry.attempt, employeeId: entry.employeeId, modelId: entry.modelId, runtimeId: entry.runtimeId, cancelRequested: entry.cancelRequested, waiting: entry.waiting, inFlight: entry.inFlight, error: this.safeDiagnosticError(entry.error) }));
      return {
        status: 200,
        body: {
          snapshot: { version: snapshot.version, generatedAt: snapshot.generatedAt, counts: snapshot.counts },
          aggregates: { waiting: snapshot.waiting.length, active: snapshot.active.length, incomplete: snapshot.incomplete.length },
          executions: sanitized,
        },
      };
    } catch {
      return { status: 503, body: safeError("coordinator_unavailable", "execution coordinator could not be queried") };
    }
  }

  private safeDiagnosticError(error: { readonly code: string; readonly message: string } | undefined): { code: string; message: string } | undefined {
    if (!error) return undefined;
    const known = new Set(["budget_blocked", "cancelled", "invalid_request", "resource_unavailable", "no_eligible_model", "no_runtime_support", "runtime_failed", "execution_failed", "dispatch_failed"]);
    const code = known.has(error.code) || error.code.startsWith("runtime_") ? error.code : "runtime_failed";
    return { code, message: code === "budget_blocked" ? "execution blocked by budget policy" : code === "cancelled" ? "execution cancelled" : "execution failed" };
  }

  private runtimeReadiness(): unknown[] {
    const registered = this.options.runtimeManager.list();
    const entries = registered.map(capabilities => {
      const supplied = this.options.runtimeReadiness?.find(entry => entry.runtimeId === capabilities.runtimeId);
      if (supplied) return { ...supplied, capabilities };
      const notes = capabilities.notes ?? [];
      const fake = capabilities.runtimeId.toLowerCase().includes("fake") || notes.some(note => /fake/i.test(note));
      const authenticationVerified = notes.some(note => /authentication=verified(?:-by-caller)?/i.test(note));
      const hasModelCoverage = capabilities.supportedModels === "*" || capabilities.supportedModels.length > 0;
      const available = capabilities.supportedProviders.length > 0 && hasModelCoverage;
      const restrictions = [
        ...(fake ? ["fake_runtime"] : []),
        ...(!authenticationVerified ? ["authentication_unverified"] : []),
        ...(!hasModelCoverage ? ["no_confirmed_models"] : []),
      ];
      return {
        runtimeId: capabilities.runtimeId,
        runtimeType: capabilities.runtimeType,
        registered: true,
        available,
        kind: fake ? "fake" : "production",
        authentication: { verified: authenticationVerified },
        supportedProviders: [...capabilities.supportedProviders],
        supportedModels: capabilities.supportedModels === "*" ? "*" : [...capabilities.supportedModels],
        capabilities: {
          session: capabilities.session,
          sessionResume: capabilities.sessionResume === true,
          cancel: capabilities.cancel === true,
          streamEvents: capabilities.streamEvents === true,
          usage: capabilities.usage === true,
          maxAdapterConcurrency: capabilities.maxAdapterConcurrency,
        },
        readiness: { ready: available && !fake && authenticationVerified, restrictions },
      };
    });
    const registeredIds = new Set(registered.map(capabilities => String(capabilities.runtimeId)));
    const configuredButUnavailable = (this.options.runtimeReadiness ?? []).filter(entry => !registeredIds.has(String(entry.runtimeId)));
    return [...entries, ...configuredButUnavailable];
  }

  private emit(event: EventRecord): void { this.events.push(event); if (this.events.length > 1000) this.events.shift(); }

  /** Enforces 415 for POST bodies that are not declared as JSON. */
  private requireJson(request: IncomingMessage): { status: number; body: unknown } | undefined {
    const contentType = request.headers["content-type"];
    if (contentType === undefined) return undefined;
    if (!contentType.toString().toLowerCase().trimStart().startsWith("application/json")) return { status: 415, body: safeError("unsupported_media_type", "content-type must be application/json") };
    return undefined;
  }

  private async body(request: IncomingMessage): Promise<unknown> { const max = this.options.maxBodyBytes ?? 1_048_576; let total = 0; const chunks: Buffer[] = []; for await (const chunk of request) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += buffer.length; if (total > max) throw Object.assign(new Error("request body too large"), { code: "payload_too_large" }); chunks.push(buffer); } if (chunks.length === 0) return undefined; try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("invalid JSON body"), { code: "invalid_json" }); } }
  private handleError(error: unknown): { status: number; body: unknown } { const code = error && typeof error === "object" && "code" in error ? String((error as unknown as { code: unknown }).code) : "bad_request"; if (code === "payload_too_large") return { status: 413, body: safeError(code, "request body is too large") }; if (code === "invalid_json") return { status: 400, body: safeError(code, "invalid JSON body") }; return { status: 500, body: safeError("internal_error", "request could not be completed") }; }
}

export function createMaoServer(options: ServerOptions): MaoServer { const app = new ServerApplication(options); const server = createServer(async (request, response) => { const result = await app.dispatch(request); response.statusCode = result.status; response.setHeader("content-type", "application/json; charset=utf-8"); response.setHeader("cache-control", "no-store"); if (result.status === 401) response.setHeader("www-authenticate", "Bearer"); if (result.status === 429) response.setHeader("retry-after", "1"); response.end(result.body === null ? undefined : json(result.body)); }); const close = async () => { await options.deliveryJournal?.close(); if (!server.listening) return; await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); }); }; return { server, app, close }; }

/**
 * Binds the server explicitly to the loopback interface: the application is
 * localhost-only by default (ADR/AGENTS rule), never all network interfaces.
 */
export function listenLocalhost(server: Server, port = 0, host = "127.0.0.1"): Promise<string> {
  if (!isLocalHost(host)) return Promise.reject(Object.assign(new Error("host must be localhost-only"), { code: "invalid_host" }));
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { resolve(serverAddress(server)); });
  });
}

export function isLocalHost(host: string): boolean { return host === "127.0.0.1" || host === "localhost" || host === "::1"; }

export function serverAddress(server: Server): string { const address = server.address() as AddressInfo | null; return address ? `${address.address}:${address.port}` : ""; }
