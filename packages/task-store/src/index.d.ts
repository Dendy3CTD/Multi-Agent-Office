export type TaskStatus = "queued" | "running" | "completed" | "failed" | "needs_review";
export interface ProjectRecord { readonly id: string; readonly name: string; readonly workspaceRoot: string; readonly createdAt: string; }
export interface TaskRequest {
  readonly projectId: string; readonly title: string; readonly brief: string;
  readonly priority?: "interactive" | "normal"; readonly complexity?: "simple" | "standard" | "complex";
  readonly acceptanceCriteria?: readonly string[];
}
export interface PlannedStep {
  readonly id: string; readonly title: string; readonly prompt: string; readonly roleId: string; readonly employeeId: string;
  readonly dependsOn?: readonly string[]; readonly safeRetry?: boolean; readonly maxAttempts?: number;
}
export interface TaskRecord extends TaskRequest {
  readonly id: string; readonly status: TaskStatus; readonly createdAt: string; readonly updatedAt: string; readonly error?: string;
}
export interface StepRecord extends PlannedStep {
  readonly attempts: number; readonly status: TaskStatus; readonly executionId?: string; readonly result?: unknown; readonly error?: string;
}
export interface TaskDetail {
  readonly task: TaskRecord; readonly project: ProjectRecord; readonly steps: readonly StepRecord[];
  readonly attempts: readonly unknown[]; readonly events: readonly unknown[];
}
export interface ClaimedExecution { readonly task: TaskRecord; readonly project: ProjectRecord; readonly step: StepRecord; }
export class IdempotencyConflictError extends Error { readonly code: "idempotency_conflict"; }
export class SqliteTaskStore {
  readonly filename: string;
  readonly maxConcurrent: number;
  constructor(options: { filename: string; maxConcurrent?: 1 | 2; now?: () => Date });
  registerProject(project: { id: string; name: string; workspaceRoot: string }): ProjectRecord;
  getProject(projectId: string): ProjectRecord | undefined;
  listProjects(): readonly ProjectRecord[];
  createTaskPlan(input: { request: TaskRequest; steps: readonly PlannedStep[]; idempotencyKey?: string }): TaskDetail;
  claimNext(): ClaimedExecution | undefined;
  listRunningExecutions(): readonly ClaimedExecution[];
  listActiveEmployeeIds(): readonly string[];
  markStepCompleted(taskId: string, stepId: string, result: unknown): TaskDetail;
  markStepFailed(taskId: string, stepId: string, error: string, options?: { safeToRetry?: boolean }): TaskDetail;
  markStepNeedsReview(taskId: string, stepId: string, reason: string): TaskDetail;
  getTask(taskId: string): TaskDetail | undefined;
  listTasks(filter?: { projectId?: string }): readonly TaskDetail[];
  close(): void;
}
