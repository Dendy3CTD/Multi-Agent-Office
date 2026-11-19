import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import catalog from "./catalog.json" with { type: "json" };

const DECOMPOSITION = Object.freeze({ simple: 1, standard: 2, complex: 3 });
const DOMAIN_ROUTES = [
  { roleId: "electronics-engineer", pattern: /электрон|электрическ|схем|плат|pcb|circuit|firmware|embedded|сенсор|датчик/i },
  { roleId: "cad-engineer", pattern: /\bcad\b|\b3d\b|модел|геометр|корпус|stl|step-файл|рендер/i },
  { roleId: "analyst", pattern: /анализ|исслед|сравн|требован|аналит|research|analy[sz]/i },
  { roleId: "developer", pattern: /код|программ|разработ|реализ|исправ|typescript|javascript|python|api|software|function|bug/i },
];

export function createDefaultRoster() {
  const professionById = new Map(catalog.professions.map((profession) => [profession.id, profession]));
  const employees = catalog.employees.map(({ profile, metadata }) => {
    const role = professionById.get(profile.professionId);
    if (!role) throw new Error(`MAO employee profile references a missing role: ${profile.professionId}`);
    return {
      id: profile.id,
      professionId: profile.professionId,
      displayName: profile.displayName,
      status: profile.status,
      skills: [...new Set([...role.skillTags, ...profile.skillOverrides])],
      instructions: [role.baseInstructions, ...role.responsibilities].filter(Boolean).join("\n\n"),
      specialization: metadata.specialization,
      departmentId: role.departmentId,
      modelDefault: profile.modelDefault,
    };
  });
  return structuredClone({ departments: catalog.departments, professions: catalog.professions, employees });
}

export function createCompany({ store, runtime, roster = createDefaultRoster(), maxConcurrent = 2 }) {
  return new Company({ store, runtime, roster, maxConcurrent });
}

export class Company {
  constructor({ store, runtime, roster, maxConcurrent = 2 }) {
    if (!store || typeof store.createTaskPlan !== "function" || typeof store.claimNext !== "function") throw new TypeError("a durable TaskStore is required");
    if (!runtime || typeof runtime.execute !== "function") throw new TypeError("a RuntimePort with execute() is required");
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 2) throw new RangeError("maxConcurrent must be 1 or 2");
    this.store = store;
    this.runtime = runtime;
    this.roster = roster;
    this.maxConcurrent = Math.min(maxConcurrent, store.maxConcurrent ?? maxConcurrent);
    this.roles = new Map(roster.professions.map((role) => [role.id, role]));
    this.employees = new Map(roster.employees.map((employee) => [employee.id, employee]));
  }

  registerProject(project) { return this.store.registerProject(project); }

  submitTask(input) {
    validateRequest(input);
    const project = this.store.getProject(input.projectId);
    if (!project) throw Object.assign(new Error("project is not registered"), { code: "project_not_found" });
    const complexity = input.complexity ?? inferComplexity(input);
    const specialistRoleId = chooseSpecialist(input.title, input.brief, this.roles);
    const request = { projectId: input.projectId, title: input.title.trim(), brief: input.brief.trim(),
      priority: input.priority ?? "normal", complexity, acceptanceCriteria: input.acceptanceCriteria ?? ["Produce a verifiable result"] };
    const steps = this.#planSteps(request, specialistRoleId);
    const saved = this.store.createTaskPlan({ request, steps, idempotencyKey: input.idempotencyKey });
    return { task: saved.task, steps: saved.steps, directorPlan: { specialistRoleId, decomposition: complexity, stepCount: saved.steps.length } };
  }

  async submitAndRun(input) {
    const accepted = this.submitTask(input);
    await this.runAvailable();
    const latest = this.getTask(accepted.task.id);
    return { ...accepted, task: latest.task, steps: latest.steps };
  }

  getTask(taskId) { return this.store.getTask(taskId); }
  listTasks(filter) { return this.store.listTasks(filter); }

  /** Reconciles durable in-flight execution IDs before queueing any new work. */
  async resume() {
    for (const execution of this.store.listRunningExecutions()) {
      let observed;
      try { observed = typeof this.runtime.inspect === "function" ? await this.runtime.inspect({
        executionId: execution.step.executionId, task: execution.task, step: execution.step, project: execution.project,
      }) : { status: "unknown" }; }
      catch { observed = { status: "unknown" }; }
      if (observed?.status === "running") continue;
      if (observed?.status === "completed") {
        this.store.markStepCompleted(execution.task.id, execution.step.id, observed.result ?? { text: observed.text ?? "" });
        this.#remember(execution.project, execution.step.employeeId, execution.task, observed.result ?? observed);
      } else if (observed?.status === "failed" && observed.executionState === "terminated" && observed.safeToRetry === true && execution.step.safeRetry) {
        this.store.markStepFailed(execution.task.id, execution.step.id, observed.error ?? "confirmed terminated execution", { safeToRetry: true });
      } else {
        this.store.markStepNeedsReview(execution.task.id, execution.step.id, observed?.reason ?? "execution outcome is unknown after restart; no duplicate dispatch was attempted");
      }
    }
    await this.runAvailable();
    return this.store.listTasks();
  }

  /** Runs only claimed steps; TaskStore enforces the global two-slot limit across Company instances. */
  async runAvailable() {
    const worker = async () => {
      while (true) {
        const execution = this.store.claimNext();
        if (!execution) return;
        await this.#runExecution(execution);
      }
    };
    await Promise.all(Array.from({ length: this.maxConcurrent }, () => worker()));
    return this.store.listTasks();
  }

  #planSteps(request, specialistRoleId) {
    const count = DECOMPOSITION[request.complexity];
    const roles = count === 1 ? [specialistRoleId] : count === 2 ? ["analyst", specialistRoleId] : ["analyst", specialistRoleId, "qa-engineer"];
    return roles.map((roleId, index) => {
      const employee = this.#selectEmployee(roleId, `${request.projectId}:${request.title}:${request.brief}:${index}`);
      const phase = count === 1 ? "work" : count === 2 ? index === 0 ? "analyze" : "specialist-work" : ["analyze", "specialist-work", "review"][index];
      const safeRetry = phase === "analyze" || phase === "review";
      const roleName = this.roles.get(roleId).name;
      const phaseInstruction = safeRetry
        ? "This step is read-only: inspect and report findings; do not modify files, call external services, or cause external side effects."
        : "Perform the assigned work within the registered project workspace and report the result.";
      return {
        id: phase,
        title: `${phase}: ${roleName}`,
        prompt: `${employee.instructions}\n\n${phaseInstruction}\n\nTask: ${request.title}\n\n${request.brief}\n\nAcceptance criteria: ${request.acceptanceCriteria.join("; ")}`,
        roleId, employeeId: employee.id, dependsOn: index ? [roles[index - 1] === roles[index] ? ["analyze", "specialist-work"][index - 1] : count === 2 ? "analyze" : ["analyze", "specialist-work"][index - 1]] : [],
        safeRetry, maxAttempts: safeRetry ? 2 : 1,
      };
    });
  }

  #selectEmployee(roleId, taskIdentity) {
    const candidates = this.roster.employees.filter((employee) => employee.status === "active" && employee.professionId === roleId);
    if (!candidates.length) throw Object.assign(new Error(`No active employee profile for required role ${roleId}`), { code: "specialist_unavailable" });
    candidates.sort((a, b) => a.id.localeCompare(b.id));
    const index = Number.parseInt(createHash("sha256").update(taskIdentity).digest("hex").slice(0, 8), 16) % candidates.length;
    return candidates[index];
  }

  async #runExecution(execution) {
    const { task, project, step } = execution;
    const profile = this.employees.get(step.employeeId);
    const role = this.roles.get(step.roleId);
    if (!profile || !role || profile.professionId !== role.id) {
      this.store.markStepNeedsReview(task.id, step.id, "saved employee or role profile is missing or no longer matches");
      return;
    }
    const context = this.#employeeContext(project, profile, role);
    try {
      const result = await this.runtime.execute({
        executionId: step.executionId,
        idempotencyKey: step.executionId,
        task,
        step,
        project,
        employee: { ...profile, role, skills: profile.skills, instructions: profile.instructions },
        workingDirectory: context.workingDirectory,
        employeeDirectory: context.employeeDirectory,
        memoryFile: context.memoryFile,
        memory: context.memory,
        signal: new AbortController().signal,
      });
      if (result?.status === "completed") {
        this.store.markStepCompleted(task.id, step.id, result);
        this.#remember(project, profile.id, task, result);
      } else if (result?.status === "failed") {
        this.store.markStepFailed(task.id, step.id, result.error ?? "Runtime reported failure", {
          safeToRetry: step.safeRetry && result.safeToRetry === true && result.executionState === "terminated",
        });
      } else {
        this.store.markStepNeedsReview(task.id, step.id, result?.reason ?? "Runtime returned an unknown or incomplete execution outcome");
      }
    } catch (error) {
      const safeToRetry = step.safeRetry && error?.executionState === "terminated" && error?.safeToRetry === true;
      if (safeToRetry) this.store.markStepFailed(task.id, step.id, error.message, { safeToRetry: true });
      else this.store.markStepNeedsReview(task.id, step.id, error instanceof Error ? error.message : "Runtime outcome is unknown; dispatch was not repeated");
    }
  }

  #employeeContext(project, employee, role) {
    const employeeDirectory = join(project.workspaceRoot, ".mao", "employees", employee.id);
    const workingDirectory = project.workspaceRoot;
    const memoryFile = join(employeeDirectory, "memory.md");
    mkdirSync(employeeDirectory, { recursive: true });
    try { readFileSync(memoryFile, "utf8"); }
    catch { writeFileSync(memoryFile, `# ${employee.displayName}\n\nRole: ${role.name}\n\n`, { flag: "wx" }); }
    return { employeeDirectory, workingDirectory, memoryFile, memory: readFileSync(memoryFile, "utf8") };
  }

  #remember(project, employeeId, task, result) {
    const employeeDirectory = join(project.workspaceRoot, ".mao", "employees", employeeId);
    const memoryFile = join(employeeDirectory, "memory.md");
    const text = typeof result?.text === "string" ? result.text : JSON.stringify(result).slice(0, 1_000);
    const previous = readFileSync(memoryFile, "utf8");
    const next = `${previous}\n## ${task.title}\n\n${text.slice(0, 2_000)}\n`;
    writeFileSync(memoryFile, next.slice(-40_000));
  }
}

function chooseSpecialist(title, brief, roles) {
  const text = `${title}\n${brief}`;
  const route = DOMAIN_ROUTES.find((candidate) => candidate.pattern.test(text));
  const roleId = route?.roleId ?? "developer";
  if (!roles.has(roleId)) throw Object.assign(new Error(`Required role ${roleId} is not registered`), { code: "specialist_unavailable" });
  return roleId;
}

function inferComplexity(input) {
  const text = `${input.title} ${input.brief}`;
  if (text.length > 700 || /end[- ]to[- ]end|complete system|несколько этап|полный цикл|с нуля.*до/i.test(text)) return "complex";
  if (text.length > 180) return "standard";
  return "simple";
}

function validateRequest(input) {
  if (!input || typeof input.projectId !== "string" || !input.projectId.trim() || typeof input.title !== "string" || !input.title.trim() ||
      typeof input.brief !== "string" || !input.brief.trim()) throw new TypeError("projectId, title, and brief are required");
  if (input.complexity !== undefined && !(input.complexity in DECOMPOSITION)) throw new TypeError("complexity must be simple, standard, or complex");
  if (input.acceptanceCriteria !== undefined && (!Array.isArray(input.acceptanceCriteria) || input.acceptanceCriteria.some((criterion) => typeof criterion !== "string" || !criterion.trim()))) {
    throw new TypeError("acceptanceCriteria must be non-empty strings");
  }
  if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128)) {
    throw new TypeError("Idempotency-Key must contain 1 to 128 characters");
  }
}
