import { BudgetExceededError, type BudgetManager, type TaskHandle, type UsageEventInput } from "@open-agent-office/budget-manager";
import type { OpenCodeRuntime, RuntimeEvent, RuntimeResult, RuntimeTaskOptions, RuntimeUsage } from "@open-agent-office/runtime-opencode";
import { DEFAULT_AGENT_MODELS, normalizeAgentModels } from "./agents.js";
import { DuplicateTaskError, InvalidTaskRequestError, OrchestratorError, TaskBudgetStopError, UnknownAgentError, UsageRecordingError } from "./errors.js";
import { SerialQueue } from "./serial-queue.js";

/** Runtime without the constructor-only parts; a fake can implement this for tests. */
export type CoordinatorRuntime = Pick<OpenCodeRuntime, "runTask">;

export interface AgentExecutionCoordinatorOptions {
  runtime: CoordinatorRuntime;
  budget: BudgetManager;
  /** agentId -> modelId. Defaults to the five starting assignments (Helper included). */
  agents?: Readonly<Record<string, string>>;
}

export interface AgentTaskRequest {
  /** Unique per task; never reused by this coordinator. Max 100 chars. */
  taskId: string;
  agentId: string;
  prompt: string;
  /** Absolute working directory. */
  cwd: string;
  title: string;
  projectId?: string;
  /** Existing OpenCode session to continue. */
  sessionId?: string;
  /** Runtime timeout. Capped by the budget task duration limit. */
  timeoutMs?: number;
  estimatedCostUsd?: number;
  estimatedTotalTokens?: number;
  estimatedOutputTokens?: number;
  estimatedReasoningTokens?: number;
  estimatedDurationMs?: number;
  requiresExtraSpend?: boolean;
  onEvent?: (event: RuntimeEvent) => void;
}

interface RunningTask {
  handle: TaskHandle;
}

/** Default Runtime timeout when neither the request nor the budget sets one. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
/** taskId length is capped so that `${taskId}:usage:${sequence}` stays a valid budget identifier. */
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ESTIMATE_FIELDS = ["estimatedCostUsd", "estimatedTotalTokens", "estimatedOutputTokens", "estimatedReasoningTokens", "estimatedDurationMs"] as const;

function identifierOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value) ? value : undefined;
}

/** Session ID as reported by OpenCode events (same shapes the Runtime recognizes). */
function sessionFromEvent(event: RuntimeEvent): string | undefined {
  const session = event.session as { id?: unknown } | undefined;
  for (const candidate of [event.sessionID, event.sessionId, event.session_id, session?.id]) {
    const value = identifierOrUndefined(candidate);
    if (value) return value;
  }
  return undefined;
}

function validateRequest(request: AgentTaskRequest): void {
  if ("modelId" in (request as object)) throw new InvalidTaskRequestError("modelId is selected by the agent configuration and cannot be passed per task");
  if (typeof request.taskId !== "string" || !TASK_ID_PATTERN.test(request.taskId)) throw new InvalidTaskRequestError("taskId must be 1-100 characters: letters, digits, '.', '_', ':', '-'");
  if (typeof request.agentId !== "string" || request.agentId.length === 0) throw new InvalidTaskRequestError("agentId is required");
  if (typeof request.prompt !== "string" || request.prompt.trim() === "") throw new InvalidTaskRequestError("prompt is required");
  if (typeof request.title !== "string" || request.title.trim() === "") throw new InvalidTaskRequestError("title is required");
  if (typeof request.cwd !== "string" || !request.cwd.startsWith("/")) throw new InvalidTaskRequestError("cwd must be an absolute path");
  if (request.projectId !== undefined && !identifierOrUndefined(request.projectId)) throw new InvalidTaskRequestError("projectId is not a valid identifier");
  if (request.sessionId !== undefined && !identifierOrUndefined(request.sessionId)) throw new InvalidTaskRequestError("sessionId is not a valid identifier");
  if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)) throw new InvalidTaskRequestError("timeoutMs must be a positive finite number");
  for (const field of ESTIMATE_FIELDS) {
    const value = request[field];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new InvalidTaskRequestError(`${field} must be a non-negative finite number`);
  }
  if (request.requiresExtraSpend !== undefined && typeof request.requiresExtraSpend !== "boolean") throw new InvalidTaskRequestError("requiresExtraSpend must be a boolean");
}

/**
 * Connects Budget Manager and OpenCode Runtime for one employee task at a time
 * per call: admission through the budget, a Runtime run with the budget's
 * AbortSignal, usage deltas recorded in order, and a single release.
 *
 * The prompt, the employee response and stderr are never sent to Budget Manager.
 */
export class AgentExecutionCoordinator {
  private readonly runtime: CoordinatorRuntime;
  private readonly budget: BudgetManager;
  private readonly models: Readonly<Record<string, string>>;
  private readonly running = new Map<string, RunningTask>();
  private readonly usedTaskIds = new Set<string>();

  constructor(options: AgentExecutionCoordinatorOptions) {
    this.runtime = options.runtime;
    this.budget = options.budget;
    this.models = normalizeAgentModels(options.agents ?? DEFAULT_AGENT_MODELS);
  }

  /** Model configured for an employee. Throws UnknownAgentError for unknown IDs. */
  modelFor(agentId: string): string {
    const modelId = Object.prototype.hasOwnProperty.call(this.models, agentId) ? this.models[agentId] : undefined;
    if (!modelId) throw new UnknownAgentError(agentId);
    return modelId;
  }

  /** Task IDs that are currently running. */
  activeTaskIds(): string[] {
    return [...this.running.keys()];
  }

  /**
   * Requests cancellation of a running task. The Runtime receives the signal,
   * terminates the child process and waits for `close`. Returns false when the
   * task is not running or was already cancelled. Never throws for finished tasks.
   */
  cancelTask(taskId: string): boolean {
    const task = this.running.get(taskId);
    if (!task || task.handle.abortController.signal.aborted) return false;
    task.handle.abortController.abort(new OrchestratorError(`Task ${taskId} was cancelled`));
    return true;
  }

  async runTask(request: AgentTaskRequest): Promise<RuntimeResult> {
    validateRequest(request);
    const model = this.modelFor(request.agentId);
    if (this.usedTaskIds.has(request.taskId)) throw new DuplicateTaskError(request.taskId);
    // Reserved before the first await: a concurrent call with the same ID is rejected too.
    this.usedTaskIds.add(request.taskId);

    const handle = await this.budget.startTask({
      taskId: request.taskId,
      agentId: request.agentId,
      modelId: model,
      projectId: request.projectId,
      sessionId: request.sessionId,
      estimatedCostUsd: request.estimatedCostUsd,
      estimatedTotalTokens: request.estimatedTotalTokens,
      estimatedOutputTokens: request.estimatedOutputTokens,
      estimatedReasoningTokens: request.estimatedReasoningTokens,
      estimatedDurationMs: request.estimatedDurationMs,
      requiresExtraSpend: request.requiresExtraSpend ?? false,
    });
    this.running.set(request.taskId, { handle });

    const usageQueue = new SerialQueue();
    let sequence = 0;
    let observedSessionId = identifierOrUndefined(request.sessionId);
    // Holder object: assignments made inside callbacks are visible to the checks below.
    // Outcome state of the run. Written from usage callbacks, read after the usage queue is drained.
    const failure: { storage?: { eventId: string; cause: unknown }; budget?: BudgetExceededError } = {};
    let result: RuntimeResult | undefined;
    let runtimeError: unknown;
    let hasRuntimeError = false;

    const recordUsage = (usage: RuntimeUsage, event: RuntimeEvent): void => {
      sequence += 1;
      const eventId = `${request.taskId}:usage:${sequence}`;
      const input: UsageEventInput = {
        eventId,
        agentId: request.agentId,
        modelId: model,
        taskId: request.taskId,
        projectId: request.projectId,
        sessionId: sessionFromEvent(event) ?? observedSessionId,
        input: usage.input,
        output: usage.output,
        reasoning: usage.reasoning,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        total: usage.total,
        costUsd: usage.cost,
      };
      usageQueue.enqueue(() => this.budget.recordUsage(input)).catch((error: unknown) => {
        if (error instanceof BudgetExceededError) {
          // Budget violation, not a storage failure. The reason is kept and reported after Runtime and the queue finish.
          failure.budget ??= error;
          if (!handle.abortController.signal.aborted) handle.abortController.abort(error);
          return;
        }
        failure.storage ??= { eventId, cause: error };
        if (!handle.abortController.signal.aborted) {
          handle.abortController.abort(new UsageRecordingError(eventId, error));
        }
      });
    };

    try {
      const options: RuntimeTaskOptions = {
        model,
        prompt: request.prompt,
        cwd: request.cwd,
        title: request.title,
        sessionId: request.sessionId,
        timeoutMs: this.timeoutFor(request.timeoutMs),
        signal: handle.abortController.signal,
        onUsage: recordUsage,
        onEvent: (event) => {
          observedSessionId = sessionFromEvent(event) ?? observedSessionId;
          request.onEvent?.(event);
        },
      };
      result = await this.runtime.runTask(options);
    } catch (error) {
      hasRuntimeError = true;
      runtimeError = error;
    } finally {
      // Usage writes must finish before the slot is released.
      await usageQueue.idle();
      this.running.delete(request.taskId);
      handle.release();
    }

    // Decision order (explicit): 1) storage failure, 2) budget stop, 3) Runtime error, 4) success.
    // A budget stop wins over a successful Runtime result, so a late violation is never reported as success.
    const signalReason = handle.abortController.signal.reason;
    const budgetStop = failure.budget ?? (signalReason instanceof BudgetExceededError ? signalReason : undefined);
    if (failure.storage) throw new UsageRecordingError(failure.storage.eventId, failure.storage.cause, budgetStop);
    if (budgetStop) throw new TaskBudgetStopError(budgetStop.reason, budgetStop, hasRuntimeError ? runtimeError : undefined);
    if (hasRuntimeError) throw runtimeError;
    return result as RuntimeResult;
  }

  /** Runtime timeout: the request value, never above the budget task duration limit. Default is 10 minutes. */
  private timeoutFor(requested: number | undefined): number {
    const limit = this.budget.policy.maxTaskDurationMs ?? DEFAULT_TIMEOUT_MS;
    return Math.min(requested ?? limit, limit);
  }
}
