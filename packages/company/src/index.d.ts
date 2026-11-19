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
  /** Both must be present before a planned safe step may be repeated. */
  readonly executionState?: "terminated" | "running" | "unknown";
  readonly safeToRetry?: boolean;
}
export interface RuntimePort {
  execute(input: {
    readonly executionId: string; readonly idempotencyKey: string; readonly task: TaskDetail["task"];
    readonly step: TaskDetail["steps"][number]; readonly project: ProjectRecord;
    readonly employee: EmployeeProfile & { readonly role: ProfessionProfile };
    readonly workingDirectory: string; readonly employeeDirectory: string; readonly memoryFile: string; readonly memory: string;
    readonly signal: AbortSignal;
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
  registerProject(project: { id: string; name: string; workspaceRoot: string }): ProjectRecord;
  submitTask(input: SubmitTaskInput): SubmitTaskResult;
  submitAndRun(input: SubmitTaskInput): Promise<SubmitTaskResult>;
  getTask(taskId: string): TaskDetail | undefined;
  listTasks(filter?: { projectId?: string }): readonly TaskDetail[];
  runAvailable(): Promise<readonly TaskDetail[]>;
  resume(): Promise<readonly TaskDetail[]>;
}
