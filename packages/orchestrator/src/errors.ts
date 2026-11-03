import type { BudgetExceededError } from "@open-agent-office/budget-manager";

/** Base class for orchestrator-level failures. Runtime and Budget errors are passed through unchanged where documented. */
export class OrchestratorError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

/** Invalid configuration passed to the orchestrator or its factory. */
export class OrchestratorConfigError extends OrchestratorError {}

/** Request validation failed before Budget Manager or Runtime was touched. */
export class InvalidTaskRequestError extends OrchestratorError {}

/** The agentId is not present in the agent model configuration. Runtime is not called. */
export class UnknownAgentError extends OrchestratorError {
  readonly agentId: string;
  constructor(agentId: string) {
    super(`Unknown agent: ${agentId}`);
    this.agentId = agentId;
  }
}

/** The taskId was already used by this coordinator; IDs are never reused. */
export class DuplicateTaskError extends OrchestratorError {
  readonly taskId: string;
  constructor(taskId: string) {
    super(`Task ${taskId} was already used and cannot be reused`);
    this.taskId = taskId;
  }
}

/**
 * Budget Manager stopped the task (limit or extra-spend block). This is reported even
 * when Runtime finished successfully, if the violation was seen before the task was
 * released. `cause` is the original BudgetExceededError. `runtimeError` is the
 * Runtime error (for example RuntimeAbortError), when Runtime also failed.
 */
export class TaskBudgetStopError extends OrchestratorError {
  readonly reason: string;
  readonly runtimeError?: unknown;
  constructor(reason: string, cause: BudgetExceededError, runtimeError?: unknown) {
    super(`Task stopped by budget policy: ${reason}`, { cause });
    this.reason = reason;
    this.runtimeError = runtimeError;
  }
}

/**
 * Usage could not be durably recorded (storage or validation failure).
 * The task was cancelled; the Runtime result, if any, is not returned.
 * `budgetStop` is set when a budget violation was also seen for this task; the
 * storage error still takes priority and is kept in `cause`.
 */
export class UsageRecordingError extends OrchestratorError {
  readonly eventId: string;
  readonly budgetStop?: BudgetExceededError;
  constructor(eventId: string, cause: unknown, budgetStop?: BudgetExceededError) {
    super(`Usage event ${eventId} could not be recorded; task was cancelled`, { cause });
    this.eventId = eventId;
    this.budgetStop = budgetStop;
  }
}
