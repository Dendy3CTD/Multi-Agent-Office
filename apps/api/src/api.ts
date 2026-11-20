import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { realpath, mkdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentEvent, RuntimeAdapter, RuntimeExecutionInput, RuntimeResult, RuntimeTaskToolContext, RuntimeToolCallEvidence, TaskScopedToolProvider } from "@mao-hybrid/contracts";
import { createCompany, createDefaultRoster, type Company, type CompanyRoster, type RuntimeExecutionResult, type RuntimePort } from "@mao-hybrid/company";
import { SqliteTaskStore, type SqliteTaskStore as SqliteTaskStoreType } from "@mao-hybrid/task-store";
import { createEventBus, type EventBus } from "@mao-hybrid/events";
import { listTools } from "@mao-hybrid/contracts";
import { codingCapabilitiesForEmployee, codingCheckFingerprint, createCodeReviewBridge, createTaskCodingDispatcher, listCodingToolSummaries, type CodeReviewPort } from "@mao-hybrid/tools-coding";
import { createTaskElectronicsDispatcher } from "@mao-hybrid/tools-electronics";
import { createTaskCadDispatcher } from "@mao-hybrid/tools-cad";
import { createEngineeringConsistencyProvider } from "./engineering-consistency-provider.js";
import { createResearchProvider } from "./research-provider.js";

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

export const BOUNDED_ENGINEERING_TEST_CONFIRMATION = "I CONFIRM: two workflow steps, one attempt each, no monetary execution hard cap.";

export async function createApiServer(options: { config: ApiConfig; runtime: ApiRuntime; roster?: CompanyRoster; events?: EventBus; taskToolProviders?: readonly TaskScopedToolProvider[] }): Promise<ApiServer> {
  const host = options.config.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") throw new TypeError("API may only bind to loopback");
  const port = options.config.port ?? 8765;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError("API port is invalid");
  const maxConcurrent = options.config.maxConcurrent ?? 2;
  if (maxConcurrent !== 1 && maxConcurrent !== 2) throw new TypeError("maxConcurrent must be one or two");
  const taskToolProviders = [createEngineeringConsistencyProvider(), createResearchProvider(), ...(options.taskToolProviders ?? [])];
  assertProviderRegistration(taskToolProviders);
  const dataDirectory = await mkdir(options.config.dataDirectory, { recursive: true }).then(() => realpath(options.config.dataDirectory));
  const store = new SqliteTaskStore({ filename: dataDirectory + "/tasks.sqlite", maxConcurrent });
  const events = createDurableEventBus(options.events ?? createEventBus());
  const runtimePort = adaptRuntimePort(options.runtime, events, store, taskToolProviders);
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
    if (request.method === "GET" && url.pathname === "/api/tools") {
      const summaries = new Map([...listTools(), ...listCodingToolSummaries()].map(tool => [tool.id, tool]));
      return sendJson(response, 200, { tools: [...summaries.values()] });
    }
    if (request.method === "GET" && url.pathname === "/api/projects") return sendJson(response, 200, { projects: store.listProjects() });
    const manifestMatch = /^\/api\/projects\/([A-Za-z0-9_-]+)\/manifest$/.exec(url.pathname);
    if (request.method === "GET" && manifestMatch) {
      const manifest = company.getProjectManifest(manifestMatch[1]!);
      return manifest ? sendJson(response, 200, manifest) : sendJson(response, 404, error("project_not_found", "Project not found"));
    }
    if (request.method === "POST" && url.pathname === "/api/projects") {
      const body = await readJson(request);
      if (!isString(body.id) || !isString(body.name) || !isString(body.workspaceRoot)) return sendJson(response, 400, error("invalid_project", "id, name and workspaceRoot are required"));
      const workspaceRoot = await realpath(body.workspaceRoot).catch(() => undefined);
      if (!workspaceRoot) return sendJson(response, 400, error("workspace_unavailable", "Project workspace must exist"));
      try { return sendJson(response, 201, { project: company.registerProject({ id: body.id, name: body.name, workspaceRoot }) }); }
      catch (cause) { return sendJson(response, 400, error(safeCode(cause, "invalid_project"), "Project could not be registered")); }
    }
    if (request.method === "POST" && url.pathname === "/api/engineering/projects") {
      const body = await readJson(request);
      if (!isString(body.id) || !isString(body.name) || !isString(body.workspaceRoot) || !isString(body.brief) || !isBudget(body.procurementBudget) || !isExecutionBudget(body.executionBudget)) {
        return sendJson(response, 400, error("invalid_engineering_project", "id, name, workspaceRoot, brief, procurementBudget and a separate USD executionBudget are required"));
      }
      if (body.acceptanceCriteria !== undefined && (!Array.isArray(body.acceptanceCriteria) || !body.acceptanceCriteria.every(isString))) return sendJson(response, 400, error("invalid_acceptance_criteria", "acceptanceCriteria must contain non-empty strings"));
      const workspaceRoot = await realpath(body.workspaceRoot).catch(() => undefined);
      if (!workspaceRoot) return sendJson(response, 400, error("workspace_unavailable", "Project workspace must exist"));
      const idempotencyHeader = request.headers["idempotency-key"];
      if (Array.isArray(idempotencyHeader) || idempotencyHeader !== undefined && (idempotencyHeader.length < 1 || idempotencyHeader.length > 128)) return sendJson(response, 400, error("invalid_idempotency_key", "Idempotency-Key must be one value up to 128 characters"));
      const acceptanceCriteria = Array.isArray(body.acceptanceCriteria) && body.acceptanceCriteria.every(isString) ? body.acceptanceCriteria : undefined;
      try {
        company.registerProject({ id: body.id, name: body.name, workspaceRoot, procurementBudget: body.procurementBudget, executionBudget: body.executionBudget });
        const accepted = company.submitEngineeringWorkflow({ projectId: body.id, title: isString(body.title) ? body.title : body.name, brief: body.brief, ...(acceptanceCriteria ? { acceptanceCriteria } : {}), ...(idempotencyHeader ? { idempotencyKey: idempotencyHeader } : {}) });
        await company.runAvailable();
        const latest = company.getTask(accepted.task.id)!;
        return sendJson(response, 201, { project: store.getProject(body.id), workflow: { ...accepted.directorPlan, task: latest.task, steps: latest.steps } });
      } catch (cause) {
        const code = safeCode(cause, "engineering_workflow_failed");
        const status = code === "project_not_found" ? 404 : code === "idempotency_conflict" ? 409 : 400;
        return sendJson(response, status, error(code, "Engineering workflow could not be created"));
      }
    }
    if (request.method === "POST" && url.pathname === "/api/engineering/test-runs") {
      const body = await readJson(request);
      if (body.confirmation !== BOUNDED_ENGINEERING_TEST_CONFIRMATION || body.stepCount !== 2 || body.maxAttemptsPerStage !== 1) return sendJson(response, 400, error("bounded_test_confirmation_required", "Exact bounded-run confirmation, two steps and one attempt per stage are required"));
      if (!isString(body.id) || !isString(body.name) || !isString(body.workspaceRoot) || !isString(body.brief) || !isBudget(body.procurementBudget) || !isExecutionBudget(body.executionBudget)) return sendJson(response, 400, error("invalid_engineering_project", "id, name, workspaceRoot, brief, procurementBudget and executionBudget are required"));
      const idempotencyHeader = request.headers["idempotency-key"];
      if (Array.isArray(idempotencyHeader) || idempotencyHeader !== undefined && (idempotencyHeader.length < 1 || idempotencyHeader.length > 128)) return sendJson(response, 400, error("invalid_idempotency_key", "Idempotency-Key must be one value up to 128 characters"));
      const workspaceRoot = await realpath(body.workspaceRoot).catch(() => undefined);
      if (!workspaceRoot) return sendJson(response, 400, error("workspace_unavailable", "Project workspace must exist"));
      const pending = store.listTasks().some(detail => ["queued", "running"].includes(detail.task.status) || detail.steps.some(step => ["queued", "running"].includes(step.status)));
      if (pending) return sendJson(response, 409, error("bounded_test_runtime_busy", "Wait until existing runtime work is no longer queued or running"));
      try {
        company.registerProject({ id: body.id, name: body.name, workspaceRoot, procurementBudget: body.procurementBudget, executionBudget: body.executionBudget });
        const accepted = company.submitBoundedResearchBomTest({ projectId: body.id, title: isString(body.title) ? body.title : body.name, brief: body.brief, confirmed: true, ...(idempotencyHeader ? { idempotencyKey: idempotencyHeader } : {}) });
        store.appendEvent(accepted.task.id, "engineering.bounded_test_confirmed", { confirmationAccepted: true, stepCount: 2, maxAttemptsPerStage: 1, monetaryHardCap: false });
        await company.runAvailable();
        const latest = company.getTask(accepted.task.id)!;
        return sendJson(response, 201, { project: store.getProject(body.id), testRun: { ...accepted.directorPlan, task: latest.task, steps: latest.steps }, executionBudgetNotice: "This bounded test has no monetary AI execution hard cap; only the configured Codex CLI is used." });
      } catch (cause) {
        const code = safeCode(cause, "bounded_test_failed");
        const status = code === "project_not_found" ? 404 : code === "idempotency_conflict" ? 409 : 400;
        return sendJson(response, status, error(code, "Bounded engineering test could not be created"));
      }
    }
    if (request.method === "GET" && url.pathname === "/api/employees") return sendJson(response, 200, { employees: roster.employees });
    if (request.method === "GET" && url.pathname === "/api/tasks") return sendJson(response, 200, { tasks: store.listTasks() });
    const taskMatch = /^\/api\/tasks\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === "GET" && taskMatch) {
      const task = company.getTask(taskMatch[1]!);
      return task ? sendJson(response, 200, task) : sendJson(response, 404, error("task_not_found", "Task not found"));
    }
    const retryMatch = /^\/api\/tasks\/([A-Za-z0-9_-]+)\/steps\/([A-Za-z0-9_-]+)\/retry$/.exec(url.pathname);
    if (request.method === "POST" && retryMatch) {
      try {
        const task = await company.retryFailedStep(retryMatch[1]!, retryMatch[2]!);
        return task ? sendJson(response, 200, task) : sendJson(response, 404, error("task_not_found", "Task not found"));
      } catch (cause) {
        const code = safeCode(cause, "step_retry_failed");
        const status = code === "task_not_found" || code === "step_not_found" ? 404 : code === "step_not_retryable" || code === "step_retry_limit_reached" ? 409 : 400;
        return sendJson(response, status, error(code, "Failed step could not be retried"));
      }
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
      if (server.listening) await new Promise<void>((resolveClose, reject) => {
        server.close(cause => cause ? reject(cause) : resolveClose());
        server.closeAllConnections();
      });
      store.close();
    },
  };
}

function adaptRuntimePort(runtime: ApiRuntime, events: EventBus, store: SqliteTaskStoreType, providers: readonly TaskScopedToolProvider[]): RuntimePort {
  let reviewSequence = 0;
  return {
    available: () => runtime.available(),
    supportsBudgetLimit: runtime.supportsBudgetLimit === true,
    execute: async input => {
      const unsubscribe = events.subscribe(input.task.id, event => {
        if (event.executionId !== input.executionId || !event.type.startsWith("tool.")) return;
        store.appendEvent(event.taskId, event.type, { executionId: event.executionId, data: event.data }, event.occurredAt);
      });
      let reviewBridge: Awaited<ReturnType<typeof createCodeReviewBridge>> | undefined;
      let codeReviewPort: CodeReviewPort | undefined;
      try {
      const requestedToolIds = requestedToolsForStep(input);
      const allowCodeReview = !input.readOnly && requestedToolIds.includes("coding.review.diff");
      const codingEmployee = {
        id: input.employee.id,
        professionId: input.employee.professionId,
        skills: input.employee.skills,
        roleCapabilities: Array.isArray(input.employee.role.capabilityRequirements)
          ? input.employee.role.capabilityRequirements.filter((capability: unknown): capability is string => typeof capability === "string")
          : [],
      };
      if (allowCodeReview && codingCapabilitiesForEmployee(codingEmployee).some(capability =>
        ["coding", "code-review", "security-review"].includes(capability))) {
        try {
          codeReviewPort = createRuntimeCodeReviewPort(runtime, input, () => ++reviewSequence);
          reviewBridge = await createCodeReviewBridge(codeReviewPort);
        } catch (cause) {
          const code = isRecord(cause) && typeof cause.code === "string" ? cause.code : "review_bridge_unavailable";
          events.publish({ taskId: input.task.id, executionId: input.executionId, type: "tools.unavailable", data: { toolIds: ["coding.review.diff"], code } });
        }
      }
      const taskTools = createTaskCodingDispatcher({
        projectId: input.project.id,
        taskId: input.task.id,
        executionId: input.executionId,
        workspaceRoot: input.project.workspaceRoot,
        employee: codingEmployee,
        allowCodeReview,
        readOnly: input.readOnly === true,
        ...(reviewBridge && codeReviewPort ? { codeReviewPort, reviewSocketPath: reviewBridge.socketPath, reviewSocketToken: reviewBridge.token } : {}),
      });
      const electronicsTools = input.readOnly ? undefined : createTaskElectronicsDispatcher({
        projectId: input.project.id,
        taskId: input.task.id,
        executionId: input.executionId,
        workspaceRoot: input.project.workspaceRoot,
        employee: { id: input.employee.id, professionId: input.employee.professionId, skills: input.employee.skills },
      });
      const cadTools = input.readOnly ? undefined : createTaskCadDispatcher({
        projectId: input.project.id,
        taskId: input.task.id,
        executionId: input.executionId,
        workspaceRoot: input.project.workspaceRoot,
        employee: { id: input.employee.id, professionId: input.employee.professionId, skills: input.employee.skills },
      });
      const providerInstances = (input.readOnly ? [] : providers).map(provider => provider.create({
        projectId: input.project.id, taskId: input.task.id, executionId: input.executionId,
        workspaceRoot: input.project.workspaceRoot,
        employee: { id: input.employee.id, professionId: input.employee.professionId, skills: input.employee.skills },
      }));
      const toolSummaries = [...taskTools.summaries, ...(electronicsTools?.summaries ?? []), ...(cadTools?.summaries ?? []), ...providerInstances.flatMap(provider => provider.summaries)];
      const forbiddenTools = toolSummaries.filter(tool => forbiddenAutomaticOperation(tool.id));
      if (forbiddenTools.length > 0) {
        events.publish({ taskId: input.task.id, executionId: input.executionId, type: "tools.unavailable", data: { employeeId: input.employee.id, forbiddenToolIds: forbiddenTools.map(tool => tool.id) } });
        return { status: "needs_review", error: `automatic_operation_forbidden:${forbiddenTools.map(tool => tool.id).join(",")}`, executionState: "terminated" };
      }
      const mcpServers = [
        ...(taskTools.tools.length > 0 ? [taskTools.mcpServer] : []),
        ...(electronicsTools?.tools.length ? [electronicsTools.mcpServer] : []),
        ...(cadTools?.mcpServer ? [cadTools.mcpServer] : []),
        ...providerInstances.flatMap(provider => provider.mcpServers),
      ];
      assertNoToolConflicts(toolSummaries, mcpServers);
      const taskToolIds = new Set(toolSummaries.map(tool => tool.id));
      if (mcpServers.length > 0) events.publish({
        taskId: input.task.id,
        executionId: input.executionId,
        type: "tools.available",
        data: { employeeId: input.employee.id, toolIds: mcpServers.flatMap(server => server.allowedTools), serverNames: mcpServers.map(server => server.name), workspaceRoot: taskTools.workspaceRoot },
      });
      const requiredToolIds = requestedToolIds.filter(toolId => taskToolIds.has(toolId));
      const missingRequestedTools = requestedToolIds.filter(toolId => !taskToolIds.has(toolId));
      const capabilities = new Set(input.readOnly ? [] : providers.flatMap(provider => provider.capabilities ?? []));
      const missingCapabilities = (input.step.requiredCapabilities ?? []).filter(capability => !capabilities.has(capability) && !toolSummaries.some(tool => tool.capabilities?.includes(capability)));
      const taskToolContext: RuntimeTaskToolContext = {
        projectId: input.project.id,
        taskId: input.task.id,
        executionId: input.executionId,
        workspaceRoot: input.project.workspaceRoot,
        tools: toolSummaries,
        mcpServers,
        requiredToolIds,
        invoke: async (toolId, toolInput) => {
          if (taskTools.tools.some(tool => tool.id === toolId)) return taskTools.invoke(toolId, toolInput);
          if (electronicsTools?.tools.some(tool => tool.id === toolId)) return electronicsTools.invoke(toolId, toolInput);
          if (cadTools?.tools.some(tool => tool.id === toolId)) return cadTools.invoke(toolId, toolInput);
          const owner = providerInstances.find(provider => provider.summaries.some(tool => tool.id === toolId));
          if (!owner) throw Object.assign(new Error("Task-scoped tool is not registered"), { code: "task_tool_unavailable" });
          return owner.invoke(toolId, toolInput);
        },
      };
      if (missingCapabilities.length > 0) {
        events.publish({ taskId: input.task.id, executionId: input.executionId, type: "tools.unavailable", data: { employeeId: input.employee.id, requiredCapabilities: missingCapabilities } });
        return { status: "needs_review", error: `engineering_dependency_unavailable:${missingCapabilities.join(",")}`, executionState: "terminated" };
      }
      if (missingRequestedTools.length > 0 && (!["analyze", "review"].includes(input.step.id) ||
        missingRequestedTools.some(toolId => input.step.requiredToolIds?.includes(toolId)))) {
        events.publish({ taskId: input.task.id, executionId: input.executionId, type: "tools.unavailable", data: { employeeId: input.employee.id, requiredToolIds: missingRequestedTools } });
        return { status: "needs_review", error: `required_mcp_tool_unavailable:${missingRequestedTools.join(",")}`, executionState: "terminated" };
      }
      const toolBoundary = toolSummaries.length === 0
        ? "MAO tool boundary: no Coding Tools are available to this employee in this step; Electronics and CAD tools are available only with their matching capabilities. Do not request or claim tool calls, code changes, or checks. Provide analysis only and hand off tool-dependent work to the assigned specialist step."
        : `MAO task-scoped tools: ${toolSummaries.map(tool => tool.id).join(", ")}.${requiredToolIds.length ? ` Required MCP tool execution for acceptance: ${requiredToolIds.join(", ")}. A text claim is not evidence; wait for and use the returned structured result.` : " Only claim tool work that appears in the actual MCP tool result."}`;
      const prompt = input.readOnly
        ? `${SOFTWARE_QA_INSTRUCTIONS}\n\n${input.step.prompt}`
        : [
          toolBoundary,
          ...(requiredToolIds.includes("coding.check.run") ? ["If the check fails, fix the cause and rerun it. Run your final check after completing all project changes. If you edit files afterward, run the check again before reporting completion."] : []),
          input.step.prompt,
        ].join("\n\n");
      const result = await runtime.execute({ ...input, step: { ...input.step, prompt }, taskTools: taskToolContext } as unknown as RuntimeExecutionInput);
      const accepted = await enforceToolAcceptance(result, requiredToolIds, events.list(input.task.id).filter(event => event.executionId === input.executionId), input.project.workspaceRoot, input.project.procurementBudget);
      return input.readOnly ? enforceSoftwareQaVerdict(accepted, input.project.workspaceRoot) : accepted;
      } finally {
        if (reviewBridge) await reviewBridge.close().catch(() => undefined);
        unsubscribe();
      }
    },
    ...(runtime.inspect ? { inspect: async input => {
      const result = await runtime.inspect!(input as unknown as Pick<RuntimeExecutionInput, "executionId" | "task" | "step" | "project">);
      // Company v0's declaration omits its implemented "running" inspection result.
      return result as unknown as RuntimeExecutionResult;
    } } : {}),
  };
}

function requestedToolsForStep(input: Parameters<RuntimePort["execute"]>[0]): string[] {
  const planned = input.step.requiredToolIds ?? [];
  if (input.task.workflowId || input.readOnly) return [...planned];
  // A handoff can mention tool calls, but only the saved request and plan define tool requirements.
  const requestText = [input.task.title, input.task.brief, ...(input.task.acceptanceCriteria ?? [])].join("\n");
  const electronics = requestedElectronicsToolIds(requestText);
  const platformioBuild = electronics.includes("electronics.platformio.build");
  const explicitCodingToolRequest = /\bcoding\.(?:check\.run|tools?)\b|coding\s+tools?\b/i.test(requestText);
  const isWorkStep = !["analyze", "review"].includes(input.step.id);
  const coding = requestedCodingToolIds(requestText).filter(toolId => {
    if (toolId === "coding.review.diff") return isWorkStep;
    if (toolId === "coding.check.run") return isWorkStep && (!platformioBuild || explicitCodingToolRequest);
    return true;
  });
  return [...new Set([...coding, ...electronics, ...requestedCadToolIds(requestText), ...planned])];
}

function requestedCodingToolIds(text: string): string[] {
  const requested: string[] = [];
  const reviewIntent = text
    .replace(/(?:\b(?:do not|don't|must not|never)\s+(?:use|call|run|invoke|require)\s+|\bwithout\s+(?:(?:using|calling|running|invoking)\s+)?|(?:не\s+(?:используй(?:те)?|использовать|вызывай(?:те)?|вызывать|запускай(?:те)?|запускать|требуется)|без(?:\s+вызова)?)\s+)`?coding\.review\.diff\b/giu, " ")
    .replace(/\bcoding\.review\.diff`?\s+(?:is\s+not\s+(?:required|needed)|must\s+not\s+be\s+(?:used|called))/gi, " ");
  if (/\bcoding\.review\.diff\b/i.test(reviewIntent)) requested.push("coding.review.diff");
  if (/\bcoding\.capabilities\b|\bcoding\s+(?:tools?\s+)?capabilities\b/i.test(text)) requested.push("coding.capabilities");
  if (/\b(git\s+status|working tree|current branch|изменени[яй]\s+в\s+git|статус\s+git)\b/i.test(text)) requested.push("coding.git.status");
  if (/\b(git\s+diff|show\s+(?:the\s+)?diff|просмотр\s+diff|diff\s+git)\b/i.test(text)) requested.push("coding.git.diff");
  if (/\b(git\s+log|commit history|истори[яю]\s+коммит)/i.test(text)) requested.push("coding.git.log");
  const checkIntent = withoutNegatedCheckRequests(text)
    .replace(/\b(?:run|execute|call)\s+electronics\.[a-z0-9_.-]+\b/gi, " ");
  const explicitCheckRun = /\bcoding\.check\.run\b/i.test(checkIntent) ||
    /\b(?:run|execute|start|launch|rerun|re-run|verify|validate)\s+(?:(?:the|a|all|these|unit|integration|automated|full|python|javascript|typescript|rust|node(?:\.js)?)\s+)*(?:tests?|test suite|testing|checks?|unittest|pytest|vitest|playwright|typecheck|lint|build|compile|compiler)\b/i.test(checkIntent) ||
    /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|build|lint|typecheck)\b|\bcargo\s+test\b|\bpython3?\s+-m\s+(?:unittest|pytest)\b|(?:^|\n)\s*(?:\$\s*)?(?:pytest|vitest|playwright)\b/i.test(checkIntent) ||
    /\b(?:tests?|test suite|checks?|build|typecheck|lint)\s+(?:must|should|need to|have to)\s+(?:pass|succeed)\b|\b(?:tests?|test suite|checks?)\s+(?:pass|passing|succeed|succeeding)\b/i.test(checkIntent) ||
    /(?:запусти|запустить|прогони|прогнать|выполни|выполнить|проведи|провести|проверь|проверить)\s+(?:(?:все|эти|юнит|интеграционные)\s+)?(?:тесты|проверки|сборку|линтер|typecheck|pytest)/iu.test(checkIntent);
  if (explicitCheckRun) requested.push("coding.check.run");
  if (requested.length === 0 && /\bcoding\s+tools?\b|\bcoding\s+tool\b|инструмент(?:ы|ом)?\s+(?:для\s+)?(?:код|разработ)/i.test(text)) requested.push("coding.capabilities");
  return [...new Set(requested)];
}

function withoutNegatedCheckRequests(text: string): string {
  return text
    .replace(/\b(?:do not|don't|must not|never)\s+(?:run|execute|start|launch|rerun|re-run|verify|validate)\b[^.!?\n]*/gi, " ")
    .replace(/не\s+(?:запускай|запускайте|запускать|прогоняй|прогоняйте|прогонять|выполняй|выполняйте|выполнять|проводи|проводите|проводить|проверяй|проверяйте|проверять)[^.!?\n]*/giu, " ");
}

function requestedElectronicsToolIds(text: string): string[] {
  const requested: string[] = [];
  if (/electronics\.ngspice\.run|\bngspice\b|\bSPICE\s+(?:netlist|simulation|analysis)\b/i.test(text)) requested.push("electronics.ngspice.run");
  if (/electronics\.kicad\.erc|\bKiCad\b.*\bERC\b|\bERC\b.*\bKiCad\b/i.test(text)) requested.push("electronics.kicad.erc");
  if (/electronics\.kicad\.drc|\bKiCad\b.*\bDRC\b|\bDRC\b.*\bKiCad\b/i.test(text)) requested.push("electronics.kicad.drc");
  if (/electronics\.kicad\.netlist|\bKiCad\b.*\bnetlist\b/i.test(text)) requested.push("electronics.kicad.netlist");
  if (/electronics\.kicad\.bom|\bKiCad\b.*\bBOM\b/i.test(text)) requested.push("electronics.kicad.bom");
  if (/electronics\.components\.validate|component.{0,16}(?:limit|constraint|validation)|ограничени[яй].{0,20}компонент/i.test(text)) requested.push("electronics.components.validate");
  if (/electronics\.bom\.validate|\bBOM\b.{0,35}(?:validate|validation|cost|провер|стоим)|(?:validate|validation|cost|провер|стоим).{0,35}\bBOM\b/i.test(text)) requested.push("electronics.bom.validate");
  if (/electronics\.electrical\.validate|electrical compatibility|электрическ.{0,30}(?:совместим|проверк)|compatibility.{0,30}(?:electrical|электр)/i.test(text)) requested.push("electronics.electrical.validate");
  if (/electronics\.platformio\.build|\bPlatformIO\b.{0,20}(?:build|сборк)/i.test(text)) requested.push("electronics.platformio.build");
  if (/electronics\.platformio\.inspect|\bPlatformIO\b.{0,20}(?:inspect|анализ|проверк)/i.test(text)) requested.push("electronics.platformio.inspect");
  return [...new Set(requested)];
}

function requestedCadToolIds(text: string): string[] {
  const ids = [
    "cad.capabilities", "cad.model.create", "cad.model.inspect", "cad.model.validate", "cad.assembly.inspect",
    "cad.export.step", "cad.export.stl", "cad.export.glb", "cad.drawing.generate", "cad.render.preview",
  ];
  const requested = ids.filter(id => new RegExp(id.replaceAll(".", "\\."), "i").test(text));
  if (/\b(?:create|design|generate|model|корпус|моделир|созда|спроектир)\b.{0,60}(?:cad|3d|enclosure|housing|корпус|esp32)|(?:cad|3d|enclosure|housing|корпус|esp32).{0,60}\b(?:create|design|generate|model|созда|спроектир)/i.test(text)) requested.push("cad.model.create");
  if (/\b(?:inspect|validate|check|проверк|проверь|валидац).{0,35}(?:cad|model|geometry|геометр|модел)/i.test(text)) requested.push("cad.model.validate");
  if (/\.step\b|\b(?:cad|3d|model|export|enclosure|housing|solid|черт[её]ж).{0,48}\b(?:step|stp)\b|\b(?:step|stp)\b.{0,48}\b(?:cad|3d|model|export|enclosure|housing|solid)\b/i.test(text)) requested.push("cad.export.step");
  if (/\.stl\b|\b(?:cad|3d|model|export|enclosure|housing|print|mesh).{0,48}\bstl\b|\bstl\b.{0,48}\b(?:cad|3d|model|export|enclosure|housing|print|mesh)\b/i.test(text)) requested.push("cad.export.stl");
  if (/\.glb\b|\b(?:cad|3d|model|export|enclosure|housing|gltf).{0,48}\b(?:glb|gltf)\b|\b(?:glb|gltf)\b.{0,48}\b(?:cad|3d|model|export|enclosure|housing)\b/i.test(text)) requested.push("cad.export.glb");
  if (/\b(?:drawing|technical drawing|черт[её]ж)/i.test(text)) requested.push("cad.drawing.generate");
  if (/\bpreview|render|предпросмотр|визуализац/i.test(text)) requested.push("cad.render.preview");
  return [...new Set(requested)];
}

function assertNoToolConflicts(tools: readonly { readonly id: string }[], servers: readonly { readonly name: string; readonly allowedTools: readonly string[] }[]): void {
  if (new Set(tools.map(tool => tool.id)).size !== tools.length) throw Object.assign(new Error("Task tool ID conflict"), { code: "task_tool_id_conflict" });
  if (new Set(servers.map(server => server.name)).size !== servers.length) throw Object.assign(new Error("Task MCP server name conflict"), { code: "task_mcp_server_name_conflict" });
  const serverToolIds = servers.flatMap(server => server.allowedTools);
  if (new Set(serverToolIds).size !== serverToolIds.length || serverToolIds.length !== tools.length || tools.some(tool => !serverToolIds.includes(tool.id))) throw Object.assign(new Error("Task MCP tool registration conflict"), { code: "task_tool_registration_conflict" });
}

function assertProviderRegistration(providers: readonly TaskScopedToolProvider[]): void {
  const ids = providers.map(provider => provider.id);
  if (ids.some(id => typeof id !== "string" || !/^[a-z][a-z0-9_.-]{1,95}$/.test(id)) || new Set(ids).size !== ids.length || providers.some(provider => typeof provider.create !== "function")) {
    throw Object.assign(new TypeError("Task-scoped tool provider registration is invalid"), { code: "task_tool_provider_invalid" });
  }
}

function forbiddenAutomaticOperation(toolId: string): boolean {
  return /(?:^|[._-])(?:purchase|purchasing|checkout|cart|buy|order|flash|flashing|upload|program-board|hardware-write|device-write|actuate|solder|high-voltage)(?:[._-]|$)/i.test(toolId);
}

const SOFTWARE_QA_INSTRUCTIONS = [
  "Independently inspect the actual implementation, tests, and other relevant files in the registered project workspace. Compare them with the task criteria and the persisted Analyst contract.",
  "Review the persisted Developer tool results directly and distinguish them from the Developer's prose. A failed, blocked, missing, or unconfirmed result is not a successful validation.",
  "This is a read-only review. Do not rerun the Developer's checks, call a nested review, or report a Developer check as a check you executed. State which Developer evidence you examined and report any gaps or findings with file paths.",
  'Return exactly one JSON object with status "approved" or "needs_review", a non-empty summary, inspectedFiles (project-relative file paths actually read), and findings (an array of descriptions). Approve only when you inspected the files and confirmed the relevant criteria and evidence. If you cannot confirm them, return needs_review and explain why.',
].join("\n");

async function enforceSoftwareQaVerdict(result: RuntimeResult, workspaceRoot: string): Promise<RuntimeResult> {
  if (result.status !== "completed") return result;
  let verdict: unknown;
  try { verdict = JSON.parse(result.text ?? ""); } catch { /* No structured verdict was returned. */ }
  if (isRecord(verdict) && verdict.status === "needs_review") {
    return { ...result, status: "needs_review", error: "qa_findings_or_unconfirmed_validation" };
  }
  if (!isRecord(verdict) || verdict.status !== "approved" || !isString(verdict.summary) ||
    !Array.isArray(verdict.findings) || verdict.findings.length || !Array.isArray(verdict.inspectedFiles) || !verdict.inspectedFiles.length) {
    return { ...result, status: "needs_review", error: "qa_verdict_unconfirmed" };
  }
  const insideWorkspace = (path: string) => {
    const local = relative(workspaceRoot, path);
    return local !== "" && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
  };
  for (const file of verdict.inspectedFiles) {
    try {
      if (isString(file) && !isAbsolute(file) && insideWorkspace(resolve(workspaceRoot, file))) {
        const actualPath = await realpath(resolve(workspaceRoot, file));
        if (insideWorkspace(actualPath) && (await stat(actualPath)).isFile()) continue;
      }
    } catch { /* The claimed file is not available in the project. */ }
    return { ...result, status: "needs_review", error: "qa_inspected_file_unconfirmed" };
  }
  return result;
}

type ToolAcceptanceResult = RuntimeResult & {
  readonly checkFingerprintDiagnostic?: {
    readonly callId: string;
    readonly reason: "missing_or_invalid_evidence" | "snapshot_unavailable" | "workspace_changed";
    readonly expected?: string;
    readonly observed?: string;
  };
};

async function enforceToolAcceptance(result: RuntimeResult, requiredToolIds: readonly string[], events: readonly AgentEvent[], workspaceRoot: string, procurementBudget?: { readonly amount: number; readonly currency: string }): Promise<ToolAcceptanceResult> {
  const reported = result.toolCalls ?? [];
  const eventEvidence = toolEvidenceFromEvents(events);
  const checkRequired = requiredToolIds.includes("coding.check.run");
  if (checkRequired) {
    const finishedChecks = new Set([...reported, ...eventEvidence].filter(isCodingCheck).map(call => call.id));
    for (const event of events) {
      if (event.type !== "tool.started" || !isCodingCheckEvent(event) || typeof event.data.itemId !== "string" ||
        finishedChecks.has(event.data.itemId)) continue;
      const id = event.data.itemId;
      eventEvidence.push({ id, server: "mao_coding", toolId: "coding.check.run", status: "unknown" });
      finishedChecks.add(id);
    }
  }
  const supplemental = eventEvidence.filter(call => !reported.some(item =>
    item.id === call.id && item.server === call.server && item.toolId === call.toolId));
  if (supplemental.length > 0) result = { ...result, toolCalls: [...reported, ...supplemental] };
  if (result.status !== "completed") return result;
  const observed = [...reported, ...eventEvidence];
  let lastCheck: RuntimeToolCallEvidence | undefined;
  if (checkRequired) {
    const runtimeChecks = reported.filter(isCodingCheck);
    const extraChecks = supplemental.filter(isCodingCheck);
    if (extraChecks.length) {
      const positions = new Map<string, number>();
      for (const event of events) {
        if (!isCodingCheckEvent(event)) continue;
        const id = typeof event.data.itemId === "string" ? event.data.itemId : `event-${event.id}`;
        if (!positions.has(id)) positions.set(id, positions.size);
      }
      const allChecks = [...runtimeChecks, ...extraChecks];
      if (allChecks.some(call => !positions.has(call.id))) {
        return { ...result, status: "needs_review", error: "required_mcp_tool_order_unverified:coding.check.run" };
      }
      lastCheck = allChecks.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!).at(-1);
    } else {
      lastCheck = runtimeChecks.at(-1);
    }
  }
  const evaluated = checkRequired ? observed.filter(call => !isCodingCheck(call) || call.id === lastCheck?.id) : observed;
  const unsuccessful = evaluated.find(call => call.status !== "completed" || toolResultFailed(call.result));
  if (unsuccessful) {
    const prefix = unsuccessful.status === "rejected" ? "mcp_tool_rejected" : unsuccessful.status === "failed" || toolResultFailed(unsuccessful.result) ? "mcp_tool_failed" : "mcp_tool_outcome_unverified";
    return { ...result, status: "needs_review", error: `${prefix}:${unsuccessful.server}/${unsuccessful.toolId}` };
  }
  const blocked = evaluated.find(call => call.status === "completed" && toolResultBlocked(call.result));
  if (blocked) {
    const reasonCode = isRecord(blocked.result) && typeof blocked.result.reasonCode === "string" ? `:${blocked.result.reasonCode}` : "";
    return { ...result, status: "needs_review", error: `mcp_tool_blocked:${blocked.server}/${blocked.toolId}${reasonCode}` };
  }
  const bomCall = observed.find(call => call.status === "completed" && call.toolId === "electronics.bom.validate");
  if (bomCall && procurementBudget) {
    const budgetIssue = validateProcurementBudgetResult(bomCall.result, procurementBudget);
    if (budgetIssue) return { ...result, status: "needs_review", error: `procurement_budget_${budgetIssue}` };
  }
  const missing = requiredToolIds.find(toolId => toolId === "coding.check.run"
    ? !lastCheck : !evaluated.some(call => call.status === "completed" && call.toolId === toolId));
  if (missing) return { ...result, status: "needs_review", error: `required_mcp_tool_not_executed:${missing}` };
  if (lastCheck) {
    const check = lastCheck.result;
    const unverified = { ...result, status: "needs_review" as const, error: "required_mcp_tool_outcome_unverified:coding.check.run" };
    const callId = lastCheck.id;
    if (!isRecord(check) || check.status !== "passed" || check.exitCode !== 0 ||
      typeof check.workspaceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(check.workspaceFingerprint)) {
      return { ...unverified, checkFingerprintDiagnostic: { callId, reason: "missing_or_invalid_evidence" } };
    }
    const expected = check.workspaceFingerprint;
    const observed = await codingCheckFingerprint(workspaceRoot).catch(() => undefined);
    if (observed === undefined) {
      return { ...unverified, checkFingerprintDiagnostic: { callId, reason: "snapshot_unavailable", expected } };
    }
    if (observed !== expected) {
      return { ...result, status: "needs_review", error: "required_mcp_tool_stale:mao_coding/coding.check.run",
        checkFingerprintDiagnostic: { callId, reason: "workspace_changed", expected, observed } };
    }
  }
  return result;
}

function isCodingCheck(call: RuntimeToolCallEvidence): boolean {
  return call.server === "mao_coding" && call.toolId === "coding.check.run";
}

function isCodingCheckEvent(event: AgentEvent): boolean {
  return event.data.tool === "mcp_tool_call" && event.data.server === "mao_coding" && event.data.toolName === "coding.check.run";
}

function createRuntimeCodeReviewPort(runtime: ApiRuntime, input: Parameters<RuntimePort["execute"]>[0], nextReviewSequence: () => number): CodeReviewPort {
  return {
    async review(request) {
      const sequence = nextReviewSequence();
      const executionId = `${input.executionId}-review-${sequence}`;
      const prompt = [
        "Perform a substantive, read-only code review using only the supplied diff, requirements, and check results.",
        "Do not modify files, execute commands, or request or use MCP tools. Do not treat supplied check claims as verified execution evidence.",
        "Return exactly one JSON object with reviewComplete:true, a non-empty summary, findings (array of objects), and optional requirementCoverage (array of objects). Use findings:[] only after completing the review and state that conclusion in summary.",
        `Requirements: ${JSON.stringify(request.requirements)}`,
        `Check results (untrusted context): ${JSON.stringify(request.checks)}`,
        "Diff to review:", request.diff,
      ].join("\n\n");
      let result: RuntimeResult;
      try {
        result = await runtime.execute({
          ...input,
          executionId,
          idempotencyKey: `${input.idempotencyKey}:review:${sequence}`,
          workingDirectory: input.project.workspaceRoot,
          readOnly: true,
          step: { ...input.step, id: `${input.step.id}-review-${sequence}`, title: "Read-only code review", prompt, requiredToolIds: [], requiredCapabilities: [] },
        } as unknown as RuntimeExecutionInput);
      } catch {
        return { status: "blocked", message: "The existing Codex Runtime reviewer failed to execute.", executionId };
      }
      if (result.status !== "completed" || typeof result.text !== "string" || !result.text.trim()) {
        return { status: "blocked", message: "The existing Codex Runtime did not complete a substantive review.", executionId, runtimeStatus: result.status };
      }
      let report: unknown;
      try { report = JSON.parse(result.text); } catch {
        return { status: "blocked", message: "The reviewer response was not valid structured JSON.", executionId, runtimeStatus: result.status };
      }
      if (!isRecord(report) || report.reviewComplete !== true || typeof report.summary !== "string" || !report.summary.trim() || !Array.isArray(report.findings) || report.findings.some(finding => !isRecord(finding)) || report.requirementCoverage !== undefined && (!Array.isArray(report.requirementCoverage) || report.requirementCoverage.some(item => !isRecord(item)))) {
        return { status: "blocked", message: "The reviewer response did not satisfy the explicit structured review contract.", executionId, runtimeStatus: result.status };
      }
      return {
        status: "completed",
        reviewComplete: true,
        executionId,
        summary: report.summary,
        findings: report.findings as Readonly<Record<string, unknown>>[],
        ...(Array.isArray(report.requirementCoverage) ? { requirementCoverage: report.requirementCoverage as Readonly<Record<string, unknown>>[] } : {}),
      };
    },
  };
}

function createDurableEventBus(events: EventBus): EventBus {
  return {
    publish: input => events.publish(input),
    list: taskId => events.list(taskId),
    subscribe: (taskId, listener) => events.subscribe(taskId, listener),
  };
}

function toolEvidenceFromEvents(events: readonly AgentEvent[]): RuntimeToolCallEvidence[] {
  const evidence: RuntimeToolCallEvidence[] = [];
  for (const event of events) {
    const data = event.data;
    if (data.tool !== "mcp_tool_call" || typeof data.server !== "string" || typeof data.toolName !== "string") continue;
    if (!["tool.completed", "tool.rejected", "tool.failed", "tool.unknown"].includes(event.type)) continue;
    const status: RuntimeToolCallEvidence["status"] = event.type === "tool.completed" ? "completed" : event.type === "tool.rejected" ? "rejected" : event.type === "tool.failed" ? "failed" : "unknown";
    evidence.push({ id: typeof data.itemId === "string" ? data.itemId : `event-${event.id}`, server: data.server, toolId: data.toolName, status, ...(typeof data.error === "string" ? { error: data.error } : {}), ...(data.result !== undefined ? { result: data.result } : {}) });
  }
  return evidence;
}

function toolResultFailed(result: unknown): boolean {
  return Boolean(isRecord(result) && ["failed", "timed_out", "FAIL", "UNSAFE"].includes(String(result.status)));
}

function toolResultBlocked(result: unknown): boolean {
  return isRecord(result) && ["blocked", "BLOCKED", "NEEDS_REVIEW", "NEEDS_DATASHEET", "OUTDATED", "UNSAFE"].includes(String(result.status));
}
function isBudget(value: unknown): value is { amount: number; currency: string } { return isRecord(value) && typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount > 0 && typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency); }
function isExecutionBudget(value: unknown): value is { amount: number; currency: "USD" } { return isRecord(value) && typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount > 0 && value.currency === "USD"; }
function validateProcurementBudgetResult(result: unknown, budget: { readonly amount: number; readonly currency: string }): string | undefined {
  if (!isRecord(result) || result.status !== "PASS" || !Array.isArray(result.costs)) return "result_unconfirmed";
  const costs = result.costs.filter(isRecord);
  if (!costs.length || costs.some(cost => cost.currency !== budget.currency || typeof cost.knownTotal !== "number" || !Number.isFinite(cost.knownTotal))) return "currency_or_cost_unconfirmed";
  return costs.reduce((sum, cost) => sum + Number(cost.knownTotal), 0) > budget.amount ? "exceeded" : undefined;
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
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function safeCode(error: unknown, fallback: string): string { return error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[a-z][a-z0-9_.-]{0,63}$/.test(error.code) ? error.code : fallback; }
