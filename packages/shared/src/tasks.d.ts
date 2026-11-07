import { type EntityId, type TaskId, type Timestamp } from "./common.js";
import type { ArtifactManifest, ValidationReport } from "./results.js";
import type { UsageTotals } from "./usage.js";
/**
 * Task domain types. Planning/DAG orchestration lives in C05/C06 (Stage 2
 * later waves); these are pure data contracts.
 */
/** Complexity class computed by C05 (rules-first). */
export type TaskComplexity = "simple" | "standard" | "complex";
/** Lifecycle statuses per TASK_LIFECYCLE §1. */
export type TaskStatus = "received" | "analyzing" | "planned" | "running" | "validating" | "accepting" | "completed" | "failed" | "cancelled" | "recovery";
/** Queue class per D-06: interactive user requests go ahead of normal work. */
export type TaskPriority = "interactive" | "normal";
/** Who originated the task. */
export type TaskOrigin = "user" | "system";
export interface Task {
    readonly id: TaskId;
    readonly projectId: EntityId;
    readonly title: string;
    readonly brief: string;
    readonly complexity: TaskComplexity;
    readonly status: TaskStatus;
    readonly priority: TaskPriority;
    readonly acceptanceCriteria: readonly string[];
    readonly createdBy: TaskOrigin;
    readonly resultSummary?: string;
    readonly createdAt: Timestamp;
    readonly updatedAt: Timestamp;
}
/** Declares that `taskId` may not start before its predecessors finish. */
export interface TaskDependency {
    readonly taskId: TaskId;
    readonly dependsOnTaskId: TaskId;
}
/**
 * Personnel booking for a task (who is intended to work). Model and Runtime
 * are deliberately absent: they are chosen per execution by C07/C17
 * (ADR-MAO-011).
 */
export interface TaskAssignment {
    readonly taskId: TaskId;
    readonly employeeId: EntityId;
    readonly professionId?: EntityId;
    readonly role?: string;
}
/** Final outcome of a task after acceptance. */
export interface TaskResult {
    readonly taskId: TaskId;
    readonly outcome: "completed" | "failed" | "cancelled";
    readonly resultSummary?: string;
    readonly validation?: ValidationReport;
    readonly artifacts: readonly ArtifactManifest[];
    readonly usage: UsageTotals;
    readonly finishedAt: Timestamp;
}
/** Light-weight pointer to persisted artifact data. */
export interface TaskArtifactReference {
    readonly artifactId: EntityId;
    readonly taskId?: TaskId;
    /** Path relative to the project root. */
    readonly path: string;
    readonly sha256?: string;
}
