import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import catalog from "./catalog.json" with { type: "json" };

const DECOMPOSITION = Object.freeze({ simple: 1, standard: 2, complex: 3 });
const ENGINEERING_WORKFLOW_ID = "engineering-v1";
const ENGINEERING_STAGES = Object.freeze([
  { id: "requirements", roleId: "analyst", title: "Requirements", artifactKind: "requirements", capabilities: [], tools: [] },
  { id: "research", roleId: "research-analyst", title: "Research", artifactKind: "research", capabilities: ["technical-research", "datasheet-analysis"], tools: ["research.web.search", "research.datasheet.extract"] },
  { id: "bom", roleId: "electronics-engineer", title: "Bill of materials", artifactKind: "bom", capabilities: ["kicad", "component-validation"], tools: ["electronics.kicad.bom", "electronics.bom.validate"] },
  { id: "electronics", roleId: "electronics-engineer", title: "Electronics design", artifactKind: "electronics", capabilities: ["component-validation", "kicad"], tools: ["electronics.components.validate", "electronics.electrical.validate", "electronics.kicad.erc"] },
  { id: "firmware", roleId: "embedded-developer", title: "Firmware", artifactKind: "firmware", capabilities: ["embedded-build"], tools: ["electronics.platformio.build"] },
  { id: "cad", roleId: "cad-engineer", title: "Mechanical CAD", artifactKind: "cad", capabilities: ["cad"], tools: ["cad.model.create", "cad.model.validate", "cad.export.step"] },
  { id: "verification", roleId: "qa-engineer", title: "Engineering consistency and verification", artifactKind: "verification", capabilities: ["engineering-consistency"], tools: ["engineering.consistency.validate"] },
  { id: "documentation", roleId: "technical-writer", title: "Documentation package", artifactKind: "documentation", capabilities: [], tools: [] },
]);
const DOMAIN_ROUTES = [
  { roleId: "cad-engineer", pattern: /\bcad\b|\b3d\b|модел|геометр|корпус|stl|step-файл|рендер/i },
  { roleId: "electronics-engineer", pattern: /электрон|электрическ|схем|плат|pcb|circuit|firmware|embedded|сенсор|датчик|electronics?|electrical|schematic|ngspice|kicad|platformio|arduino|esp32|\bvoltage divider\b|делител/i },
  { roleId: "developer", pattern: /coding\s+tools?|coding\s+tool|git\s+(?:status|diff|log)|кодировочн.*инструмент/i },
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

  submitEngineeringWorkflow(input) {
    validateEngineeringRequest(input);
    const project = this.store.getProject(input.projectId);
    if (!project) throw Object.assign(new Error("project is not registered"), { code: "project_not_found" });
    if (!project.procurementBudget || !project.executionBudget || project.executionBudget.currency !== "USD") throw Object.assign(new Error("separate procurement and USD execution budgets are required"), { code: "engineering_budgets_required" });
    const budgetCapUsd = project.executionBudget.amount / (ENGINEERING_STAGES.length * 2);
    const acceptanceCriteria = input.acceptanceCriteria ?? ["Produce a traceable design package; do not claim hardware validation without physical test evidence."];
    const steps = ENGINEERING_STAGES.map((stage, index) => {
      const employee = this.#selectEmployee(stage.roleId, `${input.projectId}:${input.title}:${stage.id}`);
      const previous = index === 0 ? [] : [ENGINEERING_STAGES[index - 1].id];
      const toolInstruction = (stage.tools.length ? `Required task-scoped tools: ${stage.tools.join(", ")}. Each must return successful structured evidence; never claim an unavailable result.` : "Use only available task-scoped tools; do not imply an unavailable source or validation occurred.") + (stage.id === "research" ? " Search results are unverified discovery leads. Cite datasheet or manufacturer values only when their tool result says VERIFIED, and preserve source URL, checkedAt, extraction, evidence and status." : stage.id === "bom" ? " Research handoff evidence includes its original trust status. Use only VERIFIED values as confirmed specifications or prices; UNVERIFIED and OUTDATED values are leads or unknowns." : "");
      const stageBudgetInstruction = stage.id === "bom" ? `Procurement ceiling: ${project.procurementBudget.amount} ${project.procurementBudget.currency}. Compare the BOM's known sourced cost to this ceiling; unknown prices or incomparable currencies require NEEDS_REVIEW. This is separate from the AI execution budget.` : "";
      const consistencyInstruction = stage.id === "verification" ? "Call engineering.consistency.validate with the package's schemaVersion 1 EngineeringProjectManifest. Use only facts explicitly present in prior artifacts/files. Do not infer missing voltage, dimensions, datasheets, versions, or source evidence. BLOCKED, unconfirmed, UNSAFE, NEEDS_DATASHEET, or contradictory results require NEEDS_REVIEW and must never be presented as READY_TO_BUILD." : "";
      const prompt = `${employee.instructions}\n\nYou are producing the ${stage.title} stage of an engineering workflow.\nProject brief: ${input.brief.trim()}\n\n${toolInstruction}\n${stageBudgetInstruction}\n${consistencyInstruction}\nReturn one JSON artifact on a line beginning ENGINEERING_ARTIFACT_JSON: . The artifact schema is {\"schemaVersion\":1,\"id\":string,\"kind\":\"${stage.artifactKind}\",\"status\":\"draft\"|\"verified\"|\"needs_review\",\"summary\":string,\"items\":[object,...],\"files\":[{\"path\":relativeProjectPath}],\"sourceEvidence\":[{\"toolId\":string,\"callId\":string}],\"assumptions\":[object,...],\"basedOnArtifactIds\":[string,...]}. Include only artifacts and evidence that actually exist. Keep unresolved datasheets, contradictory values, missing tools, and uncertain constraints explicit; these require NEEDS_REVIEW.\n\nAcceptance criteria: ${acceptanceCriteria.join("; ")}`;
      return {
        id: stage.id, title: stage.title, prompt, roleId: stage.roleId, employeeId: employee.id,
        dependsOn: previous, safeRetry: false, maxAttempts: 2, workflowStage: stage.id,
        requiredToolIds: stage.tools, requiredCapabilities: stage.capabilities, budgetCapUsd,
      };
    });
    const request = {
      projectId: input.projectId, title: input.title.trim(), brief: input.brief.trim(), priority: "normal", complexity: "complex",
      workflowId: ENGINEERING_WORKFLOW_ID,
      acceptanceCriteria,
    };
    const saved = this.store.createTaskPlan({ request, steps, idempotencyKey: input.idempotencyKey });
    return { task: saved.task, steps: saved.steps, directorPlan: { workflowId: ENGINEERING_WORKFLOW_ID, stageIds: ENGINEERING_STAGES.map(stage => stage.id), stepCount: saved.steps.length, maxParallelExecutions: this.maxConcurrent, maxAttemptsPerStage: 2 } };
  }

  submitBoundedResearchBomTest(input) {
    const project = this.store.getProject(input.projectId);
    if (!project) throw Object.assign(new Error("project is not registered"), { code: "project_not_found" });
    if (input.confirmed !== true) throw Object.assign(new Error("bounded test requires explicit confirmation"), { code: "bounded_test_confirmation_required" });
    if (!project.procurementBudget || !project.executionBudget || project.executionBudget.currency !== "USD") throw Object.assign(new Error("separate procurement and USD execution budgets are required"), { code: "engineering_budgets_required" });
    if (typeof input.title !== "string" || !input.title.trim() || typeof input.brief !== "string" || !input.brief.trim()) throw new TypeError("bounded test title and brief are required");
    const workflowId = "engineering-research-bom-test-v1";
    const stages = [ENGINEERING_STAGES.find(stage => stage.id === "research"), ENGINEERING_STAGES.find(stage => stage.id === "bom")];
    const steps = stages.map((stage, index) => {
      const employee = this.#selectEmployee(stage.roleId, `${input.projectId}:${input.title}:${workflowId}:${stage.id}`);
      const previous = index === 0 ? [] : [stages[index - 1].id];
      const prompt = `${employee.instructions}\n\nThis is a manually confirmed bounded test run. It has exactly two workflow stages and one attempt per stage. It has no monetary AI execution hard cap. Project brief: ${input.brief.trim()}\nRequired task-scoped tools: ${stage.tools.join(", ")}. Return the Engineering Artifact JSON schema and cite actual tool call IDs. Preserve research evidence and statuses. Never treat UNVERIFIED or OUTDATED values as confirmed specifications or prices.\n\nAcceptance criteria: Research results must be passed to BOM with source URL, checkedAt and status preserved; the BOM must honor the separate procurement ceiling.`;
      return {
        id: stage.id, title: stage.title, prompt, roleId: stage.roleId, employeeId: employee.id,
        dependsOn: previous, safeRetry: false, maxAttempts: 1, workflowStage: stage.id,
        requiredToolIds: stage.tools, requiredCapabilities: stage.capabilities,
      };
    });
    const request = {
      projectId: input.projectId, title: input.title.trim(), brief: input.brief.trim(), priority: "normal", complexity: "standard",
      workflowId, boundedTestMode: true, acceptanceCriteria: ["Test Research to BOM structured handoff with at most two stages and one attempt each."],
    };
    const saved = this.store.createTaskPlan({ request, steps, idempotencyKey: input.idempotencyKey });
    return { task: saved.task, steps: saved.steps, directorPlan: { workflowId, stageIds: stages.map(stage => stage.id), stepCount: 2, maxParallelExecutions: 1, maxAttemptsPerStage: 1, monetaryHardCap: false } };
  }

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

  getProjectManifest(projectId) {
    const project = this.store.getProject(projectId);
    if (!project) return undefined;
    const workflows = this.store.listTasks({ projectId }).filter(item => item.task.workflowId === ENGINEERING_WORKFLOW_ID);
    const current = workflows.at(-1);
    const artifacts = (current?.steps ?? []).flatMap(step => step.result?.engineeringArtifact ? [step.result.engineeringArtifact] : []);
    const verification = current?.steps.find(step => step.id === "verification");
    const designVerified = current?.task.status === "completed" && verification?.result?.engineeringArtifact?.status === "verified" &&
      Array.isArray(verification.result.engineeringArtifact.sourceEvidence) && verification.result.engineeringArtifact.sourceEvidence.length > 0;
    const outputs = artifacts.flatMap(artifact => artifact.files.map(file => ({ artifactId: artifact.id, kind: artifact.kind, ...file })));
    return {
      schemaVersion: 1, project, workflow: current ? { taskId: current.task.id, status: current.task.status, stages: current.steps.map(({ id, status, workflowStage, attempts, error }) => ({ id, stage: workflowStage, status, attempts, ...(error ? { error } : {}) })) } : undefined,
      artifacts, outputs,
      validation: { designStatus: designVerified ? "DESIGN_VERIFIED" : "IN_PROGRESS", workflowStatus: current?.task.status ?? "not_started", hardwareStatus: "NOT_VALIDATED", hardwareEvidence: [] },
    };
  }

  async retryFailedStep(taskId, stepId) {
    const queued = this.store.retryFailedStep(taskId, stepId);
    await this.runAvailable();
    return this.getTask(queued.task.id);
  }

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
    const handoffs = task.workflowId ? this.#engineeringHandoffs(task.id, step.dependsOn ?? []) : [];
    if (task.workflowId && this.runtime.available?.() === false) {
      this.store.markStepNeedsReview(task.id, step.id, "runtime_unavailable: engineering stage was saved without dispatch", { status: "needs_review", reason: "runtime_unavailable" });
      return;
    }
    const boundedTask = this.store.getTask(task.id);
    const boundedTest = task.workflowId === "engineering-research-bom-test-v1" && boundedTask?.steps.length === 2 && boundedTask.steps.every(item => item.maxAttempts === 1 && item.safeRetry !== true);
    if (task.workflowId && this.runtime.supportsBudgetLimit !== true && !boundedTest) {
      this.store.markStepNeedsReview(task.id, step.id, "budget_enforcement_unavailable: runtime cannot enforce the project USD execution cap", { status: "needs_review", reason: "budget_enforcement_unavailable" });
      return;
    }
    try {
      const result = await this.runtime.execute({
        executionId: step.executionId,
        idempotencyKey: step.executionId,
        task,
        step: { ...step, handoffs, ...(step.budgetCapUsd === undefined ? {} : { budgetCapUsd: step.budgetCapUsd }), prompt: task.workflowId ? withEngineeringHandoff(step.prompt, handoffs) : step.prompt },
        ...(task.workflowId && step.budgetCapUsd !== undefined ? { budget: { maxUsd: step.budgetCapUsd, currency: "USD" } } : {}),
        project,
        employee: { ...profile, role, skills: profile.skills, instructions: profile.instructions },
        workingDirectory: context.workingDirectory,
        employeeDirectory: context.employeeDirectory,
        memoryFile: context.memoryFile,
        memory: context.memory,
        signal: new AbortController().signal,
      });
      if (result?.status === "completed") {
        if (task.workflowId) {
          const checked = validateEngineeringStageResult(step, result, project, handoffs);
          if (!checked.ok) {
            this.store.markStepNeedsReview(task.id, step.id, checked.reason, result);
            return;
          }
          const normalized = { ...result, engineeringArtifact: checked.artifact };
          this.store.markStepCompleted(task.id, step.id, normalized);
          this.#remember(project, profile.id, task, normalized);
        } else {
          this.store.markStepCompleted(task.id, step.id, result);
          this.#remember(project, profile.id, task, result);
        }
      } else if (result?.status === "failed") {
        this.store.markStepFailed(task.id, step.id, result.error ?? "Runtime reported failure", {
          safeToRetry: step.safeRetry && result.safeToRetry === true && result.executionState === "terminated",
        });
      } else {
        this.store.markStepNeedsReview(task.id, step.id, result?.error ?? result?.reason ?? "Runtime returned an unknown or incomplete execution outcome", result);
      }
    } catch (error) {
      const safeToRetry = step.safeRetry && error?.executionState === "terminated" && error?.safeToRetry === true;
      if (safeToRetry) this.store.markStepFailed(task.id, step.id, error.message, { safeToRetry: true });
      else this.store.markStepNeedsReview(task.id, step.id, error instanceof Error ? error.message : "Runtime outcome is unknown; dispatch was not repeated");
    }
  }

  #engineeringHandoffs(taskId, dependencyIds) {
    const task = this.store.getTask(taskId);
    return dependencyIds.flatMap(id => {
      const step = task?.steps.find(item => item.id === id);
      return step?.status === "completed" && step.result?.engineeringArtifact ? [{ stage: step.workflowStage, artifact: step.result.engineeringArtifact }] : [];
    });
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

function validateEngineeringRequest(input) {
  validateRequest({ ...input, complexity: "complex" });
  if (!Array.isArray(input.acceptanceCriteria) && input.acceptanceCriteria !== undefined) throw new TypeError("acceptanceCriteria must be an array of non-empty strings");
}

function withEngineeringHandoff(prompt, handoffs) {
  if (!handoffs.length) return prompt;
  const json = JSON.stringify(handoffs).slice(0, 80_000);
  return `${prompt}\n\nValidated artifacts from completed prerequisite stages (structured handoff):\n${json}\nUse these records as inputs. Preserve their IDs and cite them in basedOnArtifactIds. Research evidence includes its status, URL, checkedAt, extraction and quoted evidence. Only VERIFIED values are confirmed; UNVERIFIED and OUTDATED values are leads or unknowns, never confirmed prices or characteristics. Do not silently repair contradictions; stop with needs_review.`;
}

function validateEngineeringStageResult(step, result, project, handoffs) {
  const stage = step.workflowStage;
  let artifact = result.engineeringArtifact ?? result.artifact ?? result.result?.engineeringArtifact ?? result.result?.artifact;
  if (!artifact && typeof result.text === "string") {
    const marker = "ENGINEERING_ARTIFACT_JSON:";
    const start = result.text.indexOf(marker);
    if (start >= 0) {
      const payload = result.text.slice(start + marker.length).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
      try { artifact = JSON.parse(payload); } catch { /* malformed model output is not a structured artifact */ }
    }
  }
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return { ok: false, reason: `engineering_artifact_missing:${stage}` };
  if (artifact.schemaVersion !== 1 || artifact.kind !== stage || !validIdentifier(artifact.id) || !["draft", "verified", "needs_review"].includes(artifact.status) || typeof artifact.summary !== "string" || !artifact.summary.trim() || !Array.isArray(artifact.items) || artifact.items.length === 0 || artifact.items.some(item => !item || typeof item !== "object" || Array.isArray(item)) || !Array.isArray(artifact.files) || !Array.isArray(artifact.sourceEvidence) || !Array.isArray(artifact.assumptions)) {
    return { ok: false, reason: `engineering_artifact_invalid:${stage}` };
  }
  if (artifact.status === "needs_review" || artifact.assumptions.length > 0) return { ok: false, reason: `engineering_assumptions_need_review:${stage}` };
  const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
  const successfulCalls = toolCalls.filter(call => call?.status === "completed");
  for (const toolId of step.requiredToolIds ?? []) if (!successfulCalls.some(call => call.toolId === toolId && isPassingToolResult(call.result, toolId))) return { ok: false, reason: `engineering_tool_evidence_missing:${stage}:${toolId}` };
  for (const evidence of artifact.sourceEvidence) {
    if (!evidence || typeof evidence.toolId !== "string" || typeof evidence.callId !== "string" || !successfulCalls.some(call => call.toolId === evidence.toolId && call.id === evidence.callId)) return { ok: false, reason: `engineering_source_evidence_unverified:${stage}` };
  }
  if (stage === "research" && artifact.sourceEvidence.length === 0) return { ok: false, reason: "engineering_research_has_no_verified_sources" };
  if (stage === "research" && artifact.status === "verified") {
    const citedCalls = artifact.sourceEvidence.map(evidence => successfulCalls.find(call => call.toolId === evidence.toolId && call.id === evidence.callId));
    if (citedCalls.length === 0 || citedCalls.some(call => call?.result?.status !== "VERIFIED")) return { ok: false, reason: "engineering_research_verified_without_verified_source" };
  }
  const priorArtifactIds = handoffs.map(item => item.artifact.id);
  const basedOn = Array.isArray(artifact.basedOnArtifactIds) ? artifact.basedOnArtifactIds : [];
  if (priorArtifactIds.some(id => !basedOn.includes(id))) return { ok: false, reason: `engineering_handoff_not_traceable:${stage}` };
  const files = [];
  for (const file of artifact.files) {
    if (!file || typeof file.path !== "string" || !file.path.trim() || isAbsolute(file.path) || file.path.split(/[\\/]/).includes("..")) return { ok: false, reason: `engineering_artifact_path_invalid:${stage}` };
    const target = resolve(project.workspaceRoot, file.path);
    const rel = relative(resolve(project.workspaceRoot), target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { ok: false, reason: `engineering_artifact_path_outside_project:${stage}` };
    if (!existsSync(target)) return { ok: false, reason: `engineering_artifact_file_missing:${stage}` };
    if (stage === "documentation") {
      try {
        const canonical = realpathSync(target);
        const canonicalRel = relative(realpathSync(project.workspaceRoot), canonical);
        if (canonicalRel === ".." || canonicalRel.startsWith(`..${sep}`) || !statSync(canonical).isFile()) return { ok: false, reason: "engineering_document_not_found_in_project" };
      } catch { return { ok: false, reason: "engineering_document_not_found_in_project" }; }
    } else {
      try {
        const canonical = realpathSync(target);
        const canonicalRel = relative(realpathSync(project.workspaceRoot), canonical);
        if (canonicalRel === ".." || canonicalRel.startsWith(`..${sep}`) || !statSync(canonical).isFile()) return { ok: false, reason: `engineering_artifact_path_outside_project:${stage}` };
      } catch { return { ok: false, reason: `engineering_artifact_path_invalid:${stage}` }; }
    }
    files.push({ path: file.path, ...(typeof file.mediaType === "string" ? { mediaType: file.mediaType } : {}), ...(typeof file.role === "string" ? { role: file.role } : {}) });
  }
  const validated = {
    schemaVersion: 1, id: artifact.id, kind: stage, status: artifact.status, summary: artifact.summary.trim(),
    items: artifact.items, files, sourceEvidence: artifact.sourceEvidence, assumptions: artifact.assumptions, basedOnArtifactIds: priorArtifactIds,
    ...(stage === "research" ? { researchEvidence: collectResearchEvidence(toolCalls) } : {}),
  };
  if (artifact.status === "verified" && successfulCalls.length === 0) return { ok: false, reason: `engineering_verified_without_runtime_evidence:${stage}` };
  return { ok: true, artifact: validated };
}

function isPassingToolResult(value, toolId) {
  if (toolId?.startsWith("research.")) return Boolean(value && typeof value === "object" && ["VERIFIED", "UNVERIFIED"].includes(value.status));
  if (!value || typeof value !== "object") return true;
  if (typeof value.status !== "string") return true;
  if (value.status === "READY_TO_BUILD") return Array.isArray(value.safetyGates) && value.safetyGates.length > 0 && value.safetyGates.every(gate => gate?.status === "passed") && Array.isArray(value.errors) && value.errors.length === 0 && Array.isArray(value.unconfirmed) && value.unconfirmed.length === 0;
  return ["PASS", "passed", "completed", "ok"].includes(value.status);
}

function collectResearchEvidence(toolCalls) {
  return toolCalls.filter(call => typeof call?.toolId === "string" && call.toolId.startsWith("research.")).map(call => ({
    toolId: call.toolId,
    callId: call.id,
    status: typeof call.result?.status === "string" ? call.result.status : call.status,
    ...(typeof call.result?.checkedAt === "string" ? { checkedAt: call.result.checkedAt } : {}),
    sources: collectResearchProvenance(call.result),
  }));
}

function collectResearchProvenance(value) {
  const sources = [];
  const visited = new Set();
  const visit = (current, inheritedStatus, depth) => {
    if (!current || typeof current !== "object" || depth > 12 || visited.has(current) || sources.length >= 100) return;
    visited.add(current);
    if (Array.isArray(current)) { for (const item of current) visit(item, inheritedStatus, depth + 1); return; }
    const status = typeof current.status === "string" ? current.status : inheritedStatus;
    const provenance = current.provenance;
    if (provenance && typeof provenance === "object" && typeof provenance.sourceUrl === "string" && typeof provenance.checkedAt === "string") {
      sources.push({
        url: provenance.sourceUrl.slice(0, 2048), checkedAt: provenance.checkedAt.slice(0, 80),
        status: typeof status === "string" ? status : "UNVERIFIED",
        ...(typeof provenance.sourceName === "string" ? { sourceName: provenance.sourceName.slice(0, 200) } : {}),
        ...(typeof provenance.extraction === "string" ? { extraction: provenance.extraction.slice(0, 200) } : {}),
        ...(typeof provenance.evidence === "string" ? { evidence: provenance.evidence.slice(0, 600) } : {}),
        ...(Number.isInteger(provenance.page) ? { page: provenance.page } : {}),
      });
    }
    for (const item of Object.values(current)) visit(item, status, depth + 1);
  };
  visit(value, undefined, 0);
  return sources;
}

function validIdentifier(value) { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value); }
