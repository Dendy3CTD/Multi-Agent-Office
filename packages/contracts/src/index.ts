export type TaskStatus = "queued" | "running" | "completed" | "failed" | "needs_review";

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly workspaceRoot: string;
  readonly budget?: { readonly limit: { readonly amount: number; readonly currency: "USD" } };
  readonly procurementBudget?: { readonly amount: number; readonly currency: string };
  readonly executionBudget?: { readonly amount: number; readonly currency: "USD" };
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
  readonly workflowId?: string;
}

export type EngineeringStageId = "requirements" | "research" | "bom" | "electronics" | "firmware" | "cad" | "verification" | "documentation";
export interface EngineeringArtifact {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly kind: EngineeringStageId;
  readonly status: "draft" | "verified" | "needs_review";
  readonly summary: string;
  readonly items: readonly Readonly<Record<string, unknown>>[];
  readonly files: readonly { readonly path: string; readonly mediaType?: string; readonly role?: string }[];
  readonly sourceEvidence: readonly Readonly<Record<string, unknown>>[];
  /** Host-collected Research MCP provenance. Values retain their original trust status. */
  readonly researchEvidence?: readonly Readonly<Record<string, unknown>>[];
  readonly assumptions: readonly Readonly<Record<string, unknown>>[];
  readonly basedOnArtifactIds?: readonly string[];
}
export interface EngineeringHandoff {
  readonly stage: EngineeringStageId;
  readonly artifact: EngineeringArtifact;
}
export interface TaskScopedToolProviderContext {
  readonly projectId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly workspaceRoot: string;
  readonly employee: Pick<Employee, "id" | "professionId" | "skills">;
}
export interface TaskScopedToolProviderInstance {
  readonly summaries: readonly ToolSummary[];
  readonly mcpServers: readonly RuntimeMcpServerConfig[];
  invoke(toolId: string, input: unknown): Promise<unknown>;
}
/** App-owned capability hook; each factory creates fresh task/execution-bound MCP state. */
export interface TaskScopedToolProvider {
  readonly id: string;
  readonly capabilities?: readonly string[];
  create(context: TaskScopedToolProviderContext): TaskScopedToolProviderInstance;
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
  readonly capabilities?: readonly string[];
  /** Narrow MCP safety annotation copied from the actual tool implementation. */
  readonly annotations?: ToolSafetyAnnotations;
  execute(input: Input, context?: Readonly<Record<string, unknown>>): Promise<Output> | Output;
}

export interface ToolSafetyAnnotations {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly openWorldHint?: boolean;
}

export interface ToolSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly capabilities?: readonly string[];
  readonly annotations?: ToolSafetyAnnotations;
}

/** Coding MCP tools eligible for approval when their implementation is explicitly read-only. */
export const CODEX_AUTO_APPROVED_CODING_READ_ONLY_TOOLS = Object.freeze([
  "coding.capabilities",
  "coding.git.status",
  "coding.git.diff",
  "coding.git.log",
] as const);

/** Exact task-scoped Coding tools approved under the existing workspace sandbox. */
export const CODEX_AUTO_APPROVED_CODING_WORKSPACE_TOOLS = Object.freeze([
  "coding.check.run",
  "coding.review.diff",
] as const);

/** Exact task-scoped electronics tools accepted for Codex CLI per-tool approval. */
export const CODEX_AUTO_APPROVED_ELECTRONICS_TOOLS = Object.freeze([
  "electronics.kicad.version",
  "electronics.kicad.erc",
  "electronics.ngspice.run",
  "electronics.components.validate",
  "electronics.platformio.detect",
  "electronics.platformio.inspect",
  "electronics.platformio.build",
] as const);

/** Exact task-scoped CAD tools accepted for per-tool Codex approval. */
export const CODEX_AUTO_APPROVED_CAD_TOOLS = Object.freeze([
  "cad.capabilities", "cad.model.create", "cad.model.inspect", "cad.model.validate", "cad.assembly.inspect",
  "cad.export.step", "cad.export.stl", "cad.export.glb", "cad.drawing.generate", "cad.render.preview",
] as const);

export interface RuntimeMcpServerConfig {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly allowedTools: readonly string[];
  /** Narrow per-tool Codex approvals. Omitted tools retain the server prompt policy. */
  readonly approvedToolIds?: readonly string[];
}

export interface RuntimeTaskToolContext {
  readonly projectId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly workspaceRoot: string;
  readonly tools: readonly ToolSummary[];
  readonly mcpServers: readonly RuntimeMcpServerConfig[];
  /** Tools whose successful execution is an explicit acceptance requirement. */
  readonly requiredToolIds?: readonly string[];
  invoke(toolId: string, input: unknown): Promise<unknown>;
}

export interface RuntimeToolCallEvidence {
  readonly id: string;
  readonly server: string;
  readonly toolId: string;
  readonly status: "completed" | "rejected" | "failed" | "unknown";
  readonly result?: unknown;
  readonly error?: string;
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
  readonly step: {
    readonly id: string; readonly title: string; readonly prompt: string; readonly employeeId: string;
    readonly handoffs?: readonly EngineeringHandoff[];
    readonly budgetCapUsd?: number;
    readonly requiredToolIds?: readonly string[];
    readonly requiredCapabilities?: readonly string[];
  };
  readonly project: Project;
  readonly employee: Employee & { readonly role?: { readonly id: string; readonly name: string; readonly role?: string } };
  readonly workingDirectory: string;
  readonly employeeDirectory?: string;
  readonly memoryFile?: string;
  readonly memory?: string;
  readonly signal: AbortSignal;
  /** Requests a stricter per-execution Codex sandbox; it can never widen the Runtime's configured sandbox. */
  readonly readOnly?: boolean;
  readonly budget?: { readonly maxUsd: number; readonly currency: "USD" };
  /** Task-scoped tool surface selected by the host from employee capabilities. */
  readonly taskTools?: RuntimeTaskToolContext;
}

export interface RuntimeResult {
  readonly status: "completed" | "failed" | "needs_review" | "unknown";
  readonly text?: string;
  readonly result?: unknown;
  readonly error?: string;
  readonly executionState?: "terminated" | "running" | "unknown";
  readonly safeToRetry?: boolean;
  /** Structured execution evidence from Codex JSONL; model prose is not tool evidence. */
  readonly toolCalls?: readonly RuntimeToolCallEvidence[];
}

export interface RuntimeInspectionResult extends Omit<RuntimeResult, "status"> {
  readonly status: "running" | "completed" | "failed" | "needs_review" | "unknown";
}

export interface RuntimeAdapter {
  /** True only when execute() enforces the supplied per-execution USD ceiling. */
  readonly supportsBudgetLimit?: boolean;
  execute(input: RuntimeExecutionInput): Promise<RuntimeResult>;
  inspect?(input: Pick<RuntimeExecutionInput, "executionId" | "task" | "step" | "project">): Promise<RuntimeInspectionResult>;
}

const tools = new Map<string, ToolDefinition>();

export function registerTool<Input, Output>(definition: ToolDefinition<Input, Output>): void {
  if (!/^[a-z][a-z0-9_.-]{1,95}$/.test(definition.id) || !definition.name.trim() || !definition.description.trim() || typeof definition.execute !== "function") {
    throw new TypeError("Invalid tool definition");
  }
  if (tools.has(definition.id)) throw Object.assign(new Error("Tool is already registered"), { code: "tool_already_registered" });
  tools.set(definition.id, Object.freeze({ ...definition, ...(definition.capabilities ? { capabilities: Object.freeze([...definition.capabilities]) } : {}), ...(definition.annotations ? { annotations: Object.freeze({ ...definition.annotations }) } : {}) }) as ToolDefinition);
}

export function listTools(): readonly ToolSummary[] {
  return [...tools.values()].map(({ id, name, description, inputSchema, capabilities, annotations }) => Object.freeze({ id, name, description, inputSchema, ...(capabilities ? { capabilities } : {}), ...(annotations ? { annotations } : {}) }));
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
