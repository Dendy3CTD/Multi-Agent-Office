import { type EntityId } from "./common.js";

/**
 * Multi-project workspace types (ADR-MAO-013). A project owns its root
 * directory and portfolio placement; nothing crosses project context
 * boundaries implicitly.
 */

export type ProjectStatus = "active" | "paused" | "archived";

export type ProjectPriority = "low" | "normal" | "high" | "critical";

/** A workspace root with its portfolio placement (2–5 concurrently active). */
export interface Project {
  readonly id: EntityId;
  readonly name: string;
  /** Absolute path of the workspace root (`projects/<id>/`). */
  readonly rootDir: string;
  readonly gitRemote?: string;
  /** Path to the Project Memory file consumed by C09. */
  readonly memoryFile?: string;
  readonly status: ProjectStatus;
  readonly portfolio: ProjectPriorityPolicy;
}

/** Portfolio placement of a project budget and concurrency. */
export interface ProjectPriorityPolicy {
  readonly priority: ProjectPriority;
  /** Share of the monthly budget (0..1); the sum across active projects must stay ≤ 1. */
  readonly budgetShare: number;
  /** Cap of concurrent executions this project may occupy. */
  readonly maxConcurrentExecutions: number;
}

/** Links a project to a piece of work or an external reference. */
export interface ProjectAssignment {
  readonly projectId: EntityId;
  readonly taskId?: EntityId;
  readonly note?: string;
}

/**
 * Declared interest of a project in a shared office resource (employees
 * form a common pool; slots are allocated by C20, never owned).
 */
export interface ProjectResourceReference {
  readonly projectId: EntityId;
  readonly resourceKind: "employee" | "model" | "runtime" | "work-slot";
  readonly referenceId: string;
  readonly note?: string;
}
