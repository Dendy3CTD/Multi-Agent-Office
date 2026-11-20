import type { ProjectRecord, TaskDetail, TaskRequest, TaskStatus } from "../../task-store/src/index.js";

export interface DepartmentProfile { readonly id: string; readonly name: string; readonly description?: string; readonly status?: string; }
export interface ProfessionProfile {
  readonly id: string; readonly name: string; readonly role: string; readonly departmentId: string;
  readonly baseInstructions: string; readonly responsibilities: readonly string[]; readonly skillTags: readonly string[];
  readonly status: string; readonly [key: string]: unknown;
}
export interface EmployeeProfile {
  readonly id: string; readonly professionId: string; readonly displayName: string; readonly status: string;
  readonly skills: readonly string[]; readonly instructions: string; readonly specialization: string; readonly departmentId: string;
  readonly modelDefault: string;
}
export interface CompanyRoster {
  readonly departments: readonly DepartmentProfile[]; readonly professions: readonly ProfessionProfile[]; readonly employees: readonly EmployeeProfile[];
}
export interface RuntimeExecutionResult {
  readonly status: "completed" | "failed" | "needs_review" | "unknown";
  readonly text?: string; readonly artifacts?: readonly unknown[]; readonly result?: unknown; readonly error?: string; readonly reason?: string;
  readonly toolCalls?: readonly unknown[];
  /** Both must be present before a planned safe step may be repeated. */
  readonly executionState?: "terminated" | "running" | "unknown";
  readonly safeToRetry?: boolean;
}
export interface RuntimePort {
  available?(): boolean;
  readonly supportsBudgetLimit?: boolean;
  execute(input: {
    readonly executionId: string; readonly idempotencyKey: string; readonly task: TaskDetail["task"];
    readonly step: TaskDetail["steps"][number]; readonly project: ProjectRecord;
    readonly employee: EmployeeProfile & { readonly role: ProfessionProfile };
    readonly workingDirectory: string; readonly employeeDirectory: string; readonly memoryFile: string; readonly memory: string;
    readonly signal: AbortSignal;
    readonly readOnly?: boolean;
    readonly budget?: { readonly maxUsd: number; readonly currency: "USD" };
    readonly handoffs?: readonly { readonly stage: string; readonly artifact: Readonly<Record<string, unknown>> }[];
    readonly budgetCapUsd?: number;
    readonly requiredToolIds?: readonly string[];
    readonly requiredCapabilities?: readonly string[];
  }): Promise<RuntimeExecutionResult>;
  inspect?(input: { readonly executionId: string; readonly task: TaskDetail["task"]; readonly step: TaskDetail["steps"][number]; readonly project: ProjectRecord }): Promise<RuntimeExecutionResult>;
}
export interface SubmitTaskInput extends TaskRequest { readonly idempotencyKey?: string; }
export interface SubmitTaskResult {
  readonly task: TaskDetail["task"]; readonly steps: TaskDetail["steps"];
  readonly directorPlan: { readonly specialistRoleId: string; readonly decomposition: "simple" | "standard" | "complex"; readonly stepCount: number };
}
export interface CompanyOptions { readonly store: unknown; readonly runtime: RuntimePort; readonly roster?: CompanyRoster; readonly maxConcurrent?: 1 | 2; }
export function createDefaultRoster(): CompanyRoster;
export function createCompany(options: CompanyOptions): Company;
export class Company {
  constructor(options: CompanyOptions);
  registerProject(project: { id: string; name: string; workspaceRoot: string; budget?: ProjectRecord["budget"]; procurementBudget?: ProjectRecord["procurementBudget"]; executionBudget?: ProjectRecord["executionBudget"] }): ProjectRecord;
  submitEngineeringWorkflow(input: SubmitTaskInput): SubmitEngineeringWorkflowResult;
  submitBoundedResearchBomTest(input: { readonly projectId: string; readonly title: string; readonly brief: string; readonly confirmed: true; readonly idempotencyKey?: string }): SubmitBoundedEngineeringTestResult;
  getProjectManifest(projectId: string): Readonly<Record<string, unknown>> | undefined;
  retryFailedStep(taskId: string, stepId: string): Promise<TaskDetail | undefined>;
  submitTask(input: SubmitTaskInput): SubmitTaskResult;
  submitAndRun(input: SubmitTaskInput): Promise<SubmitTaskResult>;
  getTask(taskId: string): TaskDetail | undefined;
  listTasks(filter?: { projectId?: string }): readonly TaskDetail[];
  runAvailable(): Promise<readonly TaskDetail[]>;
  resume(): Promise<readonly TaskDetail[]>;
}
export interface SubmitEngineeringWorkflowResult {
  readonly task: TaskDetail["task"];
  readonly steps: TaskDetail["steps"];
  readonly directorPlan: { readonly workflowId: string; readonly stageIds: readonly string[]; readonly stepCount: number; readonly maxParallelExecutions: number; readonly maxAttemptsPerStage: number };
}
export interface SubmitBoundedEngineeringTestResult {
  readonly task: TaskDetail["task"];
  readonly steps: TaskDetail["steps"];
  readonly directorPlan: { readonly workflowId: string; readonly stageIds: readonly string[]; readonly stepCount: 2; readonly maxParallelExecutions: 1; readonly maxAttemptsPerStage: 1; readonly monetaryHardCap: false };
}
