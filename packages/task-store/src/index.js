import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";

export class IdempotencyConflictError extends Error {
  constructor() { super("Idempotency-Key was already used with a different task request"); this.code = "idempotency_conflict"; }
}

export class SqliteTaskStore {
  constructor({ filename, maxConcurrent = 2, now = () => new Date() }) {
    if (typeof filename !== "string" || !filename.trim()) throw new TypeError("filename is required");
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 2) throw new RangeError("maxConcurrent must be 1 or 2");
    this.filename = filename;
    this.maxConcurrent = maxConcurrent;
    this.now = now;
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_root TEXT NOT NULL UNIQUE, budget_json TEXT, procurement_budget_json TEXT, execution_budget_json TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(project_id), title TEXT NOT NULL, brief TEXT NOT NULL,
        priority TEXT NOT NULL, complexity TEXT NOT NULL, acceptance_json TEXT NOT NULL, workflow_id TEXT, status TEXT NOT NULL,
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS steps (
        task_id TEXT NOT NULL REFERENCES tasks(task_id), step_id TEXT NOT NULL, position INTEGER NOT NULL,
        title TEXT NOT NULL, prompt TEXT NOT NULL, role_id TEXT NOT NULL, employee_id TEXT NOT NULL,
        depends_json TEXT NOT NULL, safe_retry_allowed INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        workflow_stage TEXT, required_tool_ids_json TEXT NOT NULL DEFAULT '[]', required_capabilities_json TEXT NOT NULL DEFAULT '[]', budget_cap_usd REAL,
        status TEXT NOT NULL, execution_id TEXT, result_json TEXT, error TEXT,
        PRIMARY KEY(task_id, step_id), UNIQUE(task_id, position)
      );
      CREATE TABLE IF NOT EXISTS execution_attempts (
        execution_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, step_id TEXT NOT NULL, attempt INTEGER NOT NULL,
        status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, result_json TEXT, error TEXT, safe_to_retry INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(task_id, step_id) REFERENCES steps(task_id, step_id)
      );
      CREATE TABLE IF NOT EXISTS idempotency (
        idempotency_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(task_id), created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(task_id), event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL
      );
    `);
    ensureColumn(this.db, "projects", "budget_json", "TEXT");
    ensureColumn(this.db, "projects", "procurement_budget_json", "TEXT");
    ensureColumn(this.db, "projects", "execution_budget_json", "TEXT");
    ensureColumn(this.db, "tasks", "workflow_id", "TEXT");
    ensureColumn(this.db, "steps", "workflow_stage", "TEXT");
    ensureColumn(this.db, "steps", "required_tool_ids_json", "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn(this.db, "steps", "required_capabilities_json", "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn(this.db, "steps", "budget_cap_usd", "REAL");
  }

  registerProject(project) {
    if (!project || !/^[A-Za-z0-9_-]{1,96}$/.test(project.id ?? "") || typeof project.name !== "string" || !project.name.trim() ||
        typeof project.workspaceRoot !== "string" || !isAbsolute(project.workspaceRoot) || project.budget !== undefined && !validBudget(project.budget) ||
        project.procurementBudget !== undefined && !validProcurementBudget(project.procurementBudget) || project.executionBudget !== undefined && !validExecutionBudget(project.executionBudget)) throw new TypeError("project id, name, absolute workspaceRoot, and valid optional budgets are required");
    const existing = this.db.prepare("SELECT name,workspace_root,budget_json,procurement_budget_json,execution_budget_json FROM projects WHERE project_id=?").get(project.id);
    if (existing) {
      if (existing.workspace_root !== project.workspaceRoot) throw Object.assign(new Error("project workspace is already registered"), { code: "project_workspace_conflict" });
      if (project.budget !== undefined && existing.budget_json && stableJson(JSON.parse(existing.budget_json)) !== stableJson(project.budget)) throw Object.assign(new Error("project budget is already registered"), { code: "project_budget_conflict" });
      if (project.procurementBudget !== undefined && existing.procurement_budget_json && stableJson(JSON.parse(existing.procurement_budget_json)) !== stableJson(project.procurementBudget)) throw Object.assign(new Error("procurement budget is already registered"), { code: "project_procurement_budget_conflict" });
      if (project.executionBudget !== undefined && existing.execution_budget_json && stableJson(JSON.parse(existing.execution_budget_json)) !== stableJson(project.executionBudget)) throw Object.assign(new Error("execution budget is already registered"), { code: "project_execution_budget_conflict" });
      if (existing.name !== project.name) this.db.prepare("UPDATE projects SET name=? WHERE project_id=?").run(project.name.trim(), project.id);
      if (project.budget !== undefined && !existing.budget_json) this.db.prepare("UPDATE projects SET budget_json=? WHERE project_id=?").run(JSON.stringify(project.budget), project.id);
      if (project.procurementBudget !== undefined && !existing.procurement_budget_json) this.db.prepare("UPDATE projects SET procurement_budget_json=? WHERE project_id=?").run(JSON.stringify(project.procurementBudget), project.id);
      if (project.executionBudget !== undefined && !existing.execution_budget_json) this.db.prepare("UPDATE projects SET execution_budget_json=? WHERE project_id=?").run(JSON.stringify(project.executionBudget), project.id);
      return this.getProject(project.id);
    }
    this.db.prepare("INSERT INTO projects(project_id,name,workspace_root,budget_json,procurement_budget_json,execution_budget_json,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(project.id, project.name.trim(), project.workspaceRoot, project.budget ? JSON.stringify(project.budget) : null, project.procurementBudget ? JSON.stringify(project.procurementBudget) : null, project.executionBudget ? JSON.stringify(project.executionBudget) : null, this.#timestamp());
    return this.getProject(project.id);
  }

  getProject(projectId) {
    const row = this.db.prepare("SELECT project_id,name,workspace_root,budget_json,procurement_budget_json,execution_budget_json,created_at FROM projects WHERE project_id=?").get(projectId);
    return row ? { id: row.project_id, name: row.name, workspaceRoot: row.workspace_root, ...(row.budget_json ? { budget: JSON.parse(row.budget_json) } : {}), ...(row.procurement_budget_json ? { procurementBudget: JSON.parse(row.procurement_budget_json) } : {}), ...(row.execution_budget_json ? { executionBudget: JSON.parse(row.execution_budget_json) } : {}), createdAt: row.created_at } : undefined;
  }

  listProjects() {
    return this.db.prepare("SELECT project_id,name,workspace_root,budget_json,procurement_budget_json,execution_budget_json,created_at FROM projects ORDER BY project_id").all()
      .map((row) => ({ id: row.project_id, name: row.name, workspaceRoot: row.workspace_root, ...(row.budget_json ? { budget: JSON.parse(row.budget_json) } : {}), ...(row.procurement_budget_json ? { procurementBudget: JSON.parse(row.procurement_budget_json) } : {}), ...(row.execution_budget_json ? { executionBudget: JSON.parse(row.execution_budget_json) } : {}), createdAt: row.created_at }));
  }

  createTaskPlan({ request, steps, idempotencyKey }) {
    this.#validateTask(request, steps, idempotencyKey);
    const project = this.getProject(request.projectId);
    if (!project) throw Object.assign(new Error("project is not registered"), { code: "project_not_found" });
    const requestHash = hash(stableJson({ request, steps }));
    return this.#transaction(() => {
      if (idempotencyKey) {
        const previous = this.db.prepare("SELECT request_hash,task_id FROM idempotency WHERE idempotency_key=?").get(idempotencyKey);
        if (previous) {
          if (previous.request_hash !== requestHash) throw new IdempotencyConflictError();
          return this.getTask(previous.task_id);
        }
      }
      const taskId = idempotencyKey ? `task-${hash(idempotencyKey).slice(0, 32)}` : `task-${randomUUID()}`;
      const timestamp = this.#timestamp();
      this.db.prepare(`INSERT INTO tasks(task_id,project_id,title,brief,priority,complexity,acceptance_json,workflow_id,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,'queued',?,?)`).run(taskId, request.projectId, request.title.trim(), request.brief.trim(), request.priority ?? "normal",
        request.complexity ?? "standard", JSON.stringify(request.acceptanceCriteria ?? []), request.workflowId ?? null, timestamp, timestamp);
      const insert = this.db.prepare(`INSERT INTO steps(task_id,step_id,position,title,prompt,role_id,employee_id,depends_json,safe_retry_allowed,max_attempts,workflow_stage,required_tool_ids_json,required_capabilities_json,budget_cap_usd,status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued')`);
      steps.forEach((step, position) => insert.run(taskId, step.id, position, step.title, step.prompt, step.roleId, step.employeeId,
        JSON.stringify(step.dependsOn ?? []), step.safeRetry === true ? 1 : 0, step.maxAttempts ?? 1, step.workflowStage ?? null,
        JSON.stringify(step.requiredToolIds ?? []), JSON.stringify(step.requiredCapabilities ?? []), step.budgetCapUsd ?? null));
      if (idempotencyKey) this.db.prepare("INSERT INTO idempotency(idempotency_key,request_hash,task_id,created_at) VALUES(?,?,?,?)")
        .run(idempotencyKey, requestHash, taskId, timestamp);
      this.#event(taskId, "task_queued", { projectId: request.projectId, stepCount: steps.length }, timestamp);
      return this.getTask(taskId);
    });
  }

  claimNext() {
    return this.#transaction(() => {
      const active = this.db.prepare("SELECT COUNT(*) AS count FROM steps WHERE status='running'").get().count;
      if (active >= this.maxConcurrent) return undefined;
      const busyEmployees = new Set(this.db.prepare("SELECT employee_id FROM steps WHERE status='running'").all().map((row) => row.employee_id));
      const candidates = this.db.prepare(`SELECT s.*,t.project_id,t.title AS task_title,t.brief AS task_brief,t.priority,t.complexity,t.acceptance_json
        FROM steps s JOIN tasks t ON t.task_id=s.task_id WHERE s.status='queued' AND t.status='queued' ORDER BY t.created_at,s.position`).all();
      const step = candidates.find((candidate) => {
        if (busyEmployees.has(candidate.employee_id)) return false;
        const dependencies = JSON.parse(candidate.depends_json);
        return dependencies.every((dependency) => this.db.prepare("SELECT status FROM steps WHERE task_id=? AND step_id=?").get(candidate.task_id, dependency)?.status === "completed");
      });
      if (!step) return undefined;
      const attempt = step.attempts + 1;
      const executionId = `${step.task_id}:${step.step_id}:attempt:${attempt}`;
      const startedAt = this.#timestamp();
      this.db.prepare("UPDATE steps SET status='running',attempts=?,execution_id=?,error=NULL WHERE task_id=? AND step_id=? AND status='queued'")
        .run(attempt, executionId, step.task_id, step.step_id);
      this.db.prepare(`INSERT INTO execution_attempts(execution_id,task_id,step_id,attempt,status,started_at)
        VALUES(?,?,?,?,'running',?)`).run(executionId, step.task_id, step.step_id, attempt, startedAt);
      this.db.prepare("UPDATE tasks SET status='running',updated_at=?,error=NULL WHERE task_id=?").run(startedAt, step.task_id);
      this.#event(step.task_id, "step_running", { stepId: step.step_id, roleId: step.role_id, employeeId: step.employee_id, executionId, attempt }, startedAt);
      return this.#executionRow(step.task_id, step.step_id);
    });
  }

  listRunningExecutions() {
    return this.db.prepare("SELECT task_id,step_id FROM steps WHERE status='running' ORDER BY task_id,position").all()
      .map(({ task_id, step_id }) => this.#executionRow(task_id, step_id));
  }

  listActiveEmployeeIds() {
    return this.db.prepare("SELECT DISTINCT employee_id FROM steps WHERE status='running'").all().map((row) => row.employee_id);
  }

  markStepCompleted(taskId, stepId, result) {
    return this.#transaction(() => {
      const execution = this.#requireRunningStep(taskId, stepId);
      const finishedAt = this.#timestamp();
      const resultJson = JSON.stringify(result ?? { text: "" });
      this.db.prepare("UPDATE steps SET status='completed',result_json=?,error=NULL WHERE task_id=? AND step_id=?")
        .run(resultJson, taskId, stepId);
      this.db.prepare("UPDATE execution_attempts SET status='completed',finished_at=?,result_json=? WHERE execution_id=?")
        .run(finishedAt, resultJson, execution.step.executionId);
      const status = this.#refreshTaskStatus(taskId, finishedAt);
      this.#event(taskId, "step_completed", { stepId, executionId: execution.step.executionId, result }, finishedAt);
      return this.getTask(taskId);
    });
  }

  markStepFailed(taskId, stepId, error, { safeToRetry = false } = {}) {
    return this.#transaction(() => {
      const execution = this.#requireRunningStep(taskId, stepId);
      const finishedAt = this.#timestamp();
      const message = String(error || "Runtime failed").slice(0, 2_000);
      const retry = safeToRetry && execution.step.attempts < execution.step.maxAttempts;
      const stepStatus = retry ? "queued" : "failed";
      this.db.prepare("UPDATE steps SET status=?,error=? WHERE task_id=? AND step_id=?").run(stepStatus, message, taskId, stepId);
      this.db.prepare("UPDATE execution_attempts SET status='failed',finished_at=?,error=?,safe_to_retry=? WHERE execution_id=?")
        .run(finishedAt, message, safeToRetry ? 1 : 0, execution.step.executionId);
      this.db.prepare("UPDATE tasks SET error=?,updated_at=? WHERE task_id=?").run(message, finishedAt, taskId);
      this.#refreshTaskStatus(taskId, finishedAt);
      this.#event(taskId, retry ? "step_retry_queued" : "step_failed", { stepId, executionId: execution.step.executionId, error: message, safeToRetry: Boolean(safeToRetry), nextAttempt: retry ? execution.step.attempts + 1 : undefined }, finishedAt);
      return this.getTask(taskId);
    });
  }

  markStepNeedsReview(taskId, stepId, reason, result) {
    return this.#transaction(() => {
      const execution = this.#requireRunningStep(taskId, stepId);
      const finishedAt = this.#timestamp();
      const message = String(reason || "Runtime outcome is unknown").slice(0, 2_000);
      const resultJson = result === undefined ? null : JSON.stringify(result);
      this.db.prepare("UPDATE steps SET status='needs_review',result_json=?,error=? WHERE task_id=? AND step_id=?").run(resultJson, message, taskId, stepId);
      this.db.prepare("UPDATE execution_attempts SET status='needs_review',finished_at=?,result_json=?,error=? WHERE execution_id=?")
        .run(finishedAt, resultJson, message, execution.step.executionId);
      this.db.prepare("UPDATE tasks SET status='needs_review',error=?,updated_at=? WHERE task_id=?").run(message, finishedAt, taskId);
      this.#event(taskId, "step_needs_review", { stepId, executionId: execution.step.executionId, reason: message, ...(result !== undefined ? { result } : {}) }, finishedAt);
      return this.getTask(taskId);
    });
  }

  markQueuedStepNeedsReview(taskId, stepId, reason, result) {
    return this.#transaction(() => {
      const step = this.db.prepare("SELECT status FROM steps WHERE task_id=? AND step_id=?").get(taskId, stepId);
      if (!step || step.status !== "queued") throw new Error("step is not queued");
      const finishedAt = this.#timestamp();
      const message = String(reason || "Execution requires review").slice(0, 2_000);
      const resultJson = result === undefined ? null : JSON.stringify(result);
      this.db.prepare("UPDATE steps SET status='needs_review',result_json=?,error=? WHERE task_id=? AND step_id=?").run(resultJson, message, taskId, stepId);
      this.db.prepare("UPDATE tasks SET status='needs_review',error=?,updated_at=? WHERE task_id=?").run(message, finishedAt, taskId);
      this.#event(taskId, "step_needs_review", { stepId, reason: message, ...(result !== undefined ? { result } : {}) }, finishedAt);
      return this.getTask(taskId);
    });
  }

  retryFailedStep(taskId, stepId) {
    return this.#transaction(() => {
      const step = this.db.prepare("SELECT status,attempts,max_attempts FROM steps WHERE task_id=? AND step_id=?").get(taskId, stepId);
      if (!step) throw Object.assign(new Error("step not found"), { code: "step_not_found" });
      if (step.status !== "failed") throw Object.assign(new Error("only a failed step can be retried"), { code: "step_not_retryable" });
      if (step.attempts >= step.max_attempts) throw Object.assign(new Error("step retry limit reached"), { code: "step_retry_limit_reached" });
      const timestamp = this.#timestamp();
      this.db.prepare("UPDATE steps SET status='queued',error=NULL WHERE task_id=? AND step_id=?").run(taskId, stepId);
      this.db.prepare("UPDATE tasks SET status='queued',error=NULL,updated_at=? WHERE task_id=?").run(timestamp, taskId);
      this.#event(taskId, "step_retry_queued", { stepId, manual: true, nextAttempt: step.attempts + 1 }, timestamp);
      return this.getTask(taskId);
    });
  }

  getTask(taskId) {
    const row = this.db.prepare("SELECT * FROM tasks WHERE task_id=?").get(taskId);
    if (!row) return undefined;
    const project = this.getProject(row.project_id);
    const steps = this.db.prepare("SELECT * FROM steps WHERE task_id=? ORDER BY position").all(taskId).map((step) => ({
      id: step.step_id, title: step.title, prompt: step.prompt, roleId: step.role_id, employeeId: step.employee_id,
      dependsOn: JSON.parse(step.depends_json), safeRetry: step.safe_retry_allowed === 1, maxAttempts: step.max_attempts, attempts: step.attempts, status: step.status,
      ...(step.workflow_stage ? { workflowStage: step.workflow_stage } : {}), requiredToolIds: JSON.parse(step.required_tool_ids_json ?? "[]"),
      requiredCapabilities: JSON.parse(step.required_capabilities_json ?? "[]"), ...(step.budget_cap_usd === null ? {} : { budgetCapUsd: step.budget_cap_usd }),
      ...(step.execution_id ? { executionId: step.execution_id } : {}), ...(step.result_json ? { result: JSON.parse(step.result_json) } : {}),
      ...(step.error ? { error: step.error } : {}),
    }));
    const attempts = this.db.prepare("SELECT * FROM execution_attempts WHERE task_id=? ORDER BY started_at").all(taskId).map((attempt) => ({
      executionId: attempt.execution_id, stepId: attempt.step_id, attempt: attempt.attempt, status: attempt.status,
      startedAt: attempt.started_at, ...(attempt.finished_at ? { finishedAt: attempt.finished_at } : {}),
      ...(attempt.result_json ? { result: JSON.parse(attempt.result_json) } : {}), ...(attempt.error ? { error: attempt.error } : {}),
      safeToRetry: attempt.safe_to_retry === 1,
    }));
    const events = this.db.prepare("SELECT sequence,event_type,occurred_at,payload_json FROM task_events WHERE task_id=? ORDER BY sequence").all(taskId)
      .map((event) => ({ sequence: event.sequence, type: event.event_type, occurredAt: event.occurred_at, ...JSON.parse(event.payload_json) }));
    const task = { id: row.task_id, projectId: row.project_id, title: row.title, brief: row.brief, priority: row.priority,
      complexity: row.complexity, acceptanceCriteria: JSON.parse(row.acceptance_json), ...(row.workflow_id ? { workflowId: row.workflow_id } : {}), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
      ...(row.error ? { error: row.error } : {}) };
    return { task, project, steps, attempts, events };
  }

  listTasks({ projectId } = {}) {
    const rows = projectId ? this.db.prepare("SELECT task_id FROM tasks WHERE project_id=? ORDER BY created_at").all(projectId)
      : this.db.prepare("SELECT task_id FROM tasks ORDER BY created_at").all();
    return rows.map((row) => this.getTask(row.task_id));
  }

  appendEvent(taskId, type, payload, occurredAt = this.#timestamp()) {
    if (typeof taskId !== "string" || !taskId || typeof type !== "string" || !/^[a-z][a-z0-9_.-]{0,95}$/.test(type)) throw new TypeError("task event identity is invalid");
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof occurredAt !== "string" || !Number.isFinite(Date.parse(occurredAt))) throw new TypeError("task event payload and timestamp are invalid");
    if (!this.db.prepare("SELECT 1 FROM tasks WHERE task_id=?").get(taskId)) throw Object.assign(new Error("task not found"), { code: "task_not_found" });
    return this.#transaction(() => {
      this.#event(taskId, type, payload, occurredAt);
      return this.getTask(taskId).events.at(-1);
    });
  }

  close() { this.db.close(); }

  #validateTask(request, steps, idempotencyKey) {
    if (!request || typeof request.projectId !== "string" || !request.projectId.trim() || typeof request.title !== "string" || !request.title.trim() ||
        typeof request.brief !== "string" || !request.brief.trim() ||
        request.priority !== undefined && !["interactive", "normal"].includes(request.priority) ||
        request.complexity !== undefined && !["simple", "standard", "complex"].includes(request.complexity)) throw new TypeError("projectId, title, and brief are required");
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 12) throw new RangeError("a task plan must contain 1 to 12 steps");
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)) throw new TypeError("Idempotency-Key must contain 1 to 128 characters");
    const seen = new Set();
    for (const step of steps) {
      if (!step || !/^[A-Za-z0-9_-]{1,96}$/.test(step.id ?? "") || seen.has(step.id) || !step.title?.trim() || !step.prompt?.trim() ||
          !step.roleId?.trim() || !step.employeeId?.trim() || !Number.isInteger(step.maxAttempts ?? 1) || (step.maxAttempts ?? 1) < 1 || (step.maxAttempts ?? 1) > 3 ||
          step.safeRetry !== undefined && typeof step.safeRetry !== "boolean") {
        throw new TypeError("task steps require unique ids, a specialist, and 1 to 3 bounded attempts");
      }
      const dependencies = step.dependsOn ?? [];
      if (!Array.isArray(dependencies) || dependencies.some((dependency) => !seen.has(dependency))) throw new TypeError("step dependencies must refer to an earlier step");
      seen.add(step.id);
    }
  }

  #requireRunningStep(taskId, stepId) {
    const execution = this.#executionRow(taskId, stepId);
    if (!execution || execution.step.status !== "running") throw new Error("step is not running");
    return execution;
  }

  #executionRow(taskId, stepId) {
    const row = this.db.prepare(`SELECT s.*,t.project_id,t.title AS task_title,t.brief AS task_brief,t.priority,t.complexity,t.acceptance_json,t.workflow_id
      FROM steps s JOIN tasks t ON t.task_id=s.task_id WHERE s.task_id=? AND s.step_id=?`).get(taskId, stepId);
    if (!row) return undefined;
    return { task: { id: row.task_id, projectId: row.project_id, title: row.task_title, brief: row.task_brief, priority: row.priority,
      complexity: row.complexity, acceptanceCriteria: JSON.parse(row.acceptance_json), ...(row.workflow_id ? { workflowId: row.workflow_id } : {}) }, project: this.getProject(row.project_id),
      step: { id: row.step_id, title: row.title, prompt: row.prompt, roleId: row.role_id, employeeId: row.employee_id,
        dependsOn: JSON.parse(row.depends_json), safeRetry: row.safe_retry_allowed === 1, maxAttempts: row.max_attempts, attempts: row.attempts, status: row.status,
        ...(row.workflow_stage ? { workflowStage: row.workflow_stage } : {}), requiredToolIds: JSON.parse(row.required_tool_ids_json ?? "[]"),
        requiredCapabilities: JSON.parse(row.required_capabilities_json ?? "[]"), ...(row.budget_cap_usd === null ? {} : { budgetCapUsd: row.budget_cap_usd }),
        ...(row.execution_id ? { executionId: row.execution_id } : {}) } };
  }

  #refreshTaskStatus(taskId, timestamp) {
    const steps = this.db.prepare("SELECT status FROM steps WHERE task_id=?").all(taskId).map((row) => row.status);
    const status = steps.includes("running") ? "running" : steps.includes("needs_review") ? "needs_review" : steps.includes("failed") ? "failed" :
      steps.every((step) => step === "completed") ? "completed" : "queued";
    this.db.prepare("UPDATE tasks SET status=?,updated_at=? WHERE task_id=?").run(status, timestamp, taskId);
    return status;
  }

  #event(taskId, type, payload, timestamp = this.#timestamp()) {
    this.db.prepare("INSERT INTO task_events(task_id,event_type,occurred_at,payload_json) VALUES(?,?,?,?)")
      .run(taskId, type, timestamp, JSON.stringify(payload));
  }

  #timestamp() { return this.now().toISOString(); }

  #transaction(operation) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function validBudget(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.limit && typeof value.limit === "object" &&
    Number.isFinite(value.limit.amount) && value.limit.amount > 0 && value.limit.currency === "USD");
}

function validProcurementBudget(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Number.isFinite(value.amount) && value.amount > 0 && typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency));
}

function validExecutionBudget(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Number.isFinite(value.amount) && value.amount > 0 && value.currency === "USD");
}

function ensureColumn(database, table, column, declaration) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
