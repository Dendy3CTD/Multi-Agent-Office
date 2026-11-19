export type TaskStatus = "queued" | "running" | "completed" | "failed" | "needs_review";

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly workspaceRoot: string;
  readonly createdAt?: string;
}

export interface Employee {
  readonly id: string;
  readonly professionId: string;
  readonly displayName: string;
  readonly status: string;
  readonly skills: readonly string[];
  readonly instructions: string;
  readonly specialization: string;
  readonly departmentId: string;
  readonly modelDefault?: string;
}

export interface Task {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly brief: string;
  readonly status: TaskStatus;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly error?: string;
}

export interface Execution {
  readonly id: string;
  readonly taskId: string;
  readonly stepId: string;
  readonly employeeId: string;
  readonly status: TaskStatus;
  readonly attempts: number;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly result?: unknown;
  readonly error?: string;
}

export interface AgentEvent {
  readonly id: number;
  readonly taskId: string;
  readonly executionId: string;
  readonly occurredAt: string;
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  execute(input: Input, context?: Readonly<Record<string, unknown>>): Promise<Output> | Output;
}

export interface ToolSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ToolResult<Output = unknown> {
  readonly toolId: string;
  readonly status: "completed" | "failed";
  readonly output?: Output;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface RuntimeExecutionInput {
  readonly executionId: string;
  readonly idempotencyKey: string;
  readonly task: Task;
  readonly step: { readonly id: string; readonly title: string; readonly prompt: string; readonly employeeId: string };
  readonly project: Project;
  readonly employee: Employee & { readonly role?: { readonly id: string; readonly name: string; readonly role?: string } };
  readonly workingDirectory: string;
  readonly employeeDirectory?: string;
  readonly memoryFile?: string;
  readonly memory?: string;
  readonly signal: AbortSignal;
}

export interface RuntimeResult {
  readonly status: "completed" | "failed" | "needs_review" | "unknown";
  readonly text?: string;
  readonly result?: unknown;
  readonly error?: string;
  readonly executionState?: "terminated" | "running" | "unknown";
  readonly safeToRetry?: boolean;
}

export interface RuntimeInspectionResult extends Omit<RuntimeResult, "status"> {
  readonly status: "running" | "completed" | "failed" | "needs_review" | "unknown";
}

export interface RuntimeAdapter {
  execute(input: RuntimeExecutionInput): Promise<RuntimeResult>;
  inspect?(input: Pick<RuntimeExecutionInput, "executionId" | "task" | "step" | "project">): Promise<RuntimeInspectionResult>;
}

const tools = new Map<string, ToolDefinition>();

export function registerTool<Input, Output>(definition: ToolDefinition<Input, Output>): void {
  if (!/^[a-z][a-z0-9_.-]{1,95}$/.test(definition.id) || !definition.name.trim() || !definition.description.trim() || typeof definition.execute !== "function") {
    throw new TypeError("Invalid tool definition");
  }
  if (tools.has(definition.id)) throw Object.assign(new Error("Tool is already registered"), { code: "tool_already_registered" });
  tools.set(definition.id, definition as ToolDefinition);
}

export function listTools(): readonly ToolSummary[] {
  return [...tools.values()].map(({ id, name, description, inputSchema }) => Object.freeze({ id, name, description, inputSchema }));
}

export async function executeTool<Output = unknown>(toolId: string, input: unknown, context?: Readonly<Record<string, unknown>>): Promise<ToolResult<Output>> {
  const tool = tools.get(toolId);
  if (!tool) throw Object.assign(new Error("Tool is not registered"), { code: "tool_not_found" });
  try {
    const output = await tool.execute(input, context);
    return { toolId, status: "completed", output: output as Output };
  } catch {
    return { toolId, status: "failed", error: { code: "tool_execution_failed", message: "Tool execution failed" } };
  }
}
