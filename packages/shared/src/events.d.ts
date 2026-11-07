import { type EntityId, type EventId, type ModelId, type RuntimeId, type TaskId, type Timestamp } from "./common.js";
/**
 * Event contracts. Durable-first ordering and idempotent storage by
 * `eventId` live in C06/C14 (ADR-MAO-008); this module defines only the
 * wire/storage shapes.
 */
/** Actor that produced an event. */
export type EventActor = "user" | "system" | "employee" | "guard";
/** Trace pointers carried by every envelope (all optional). */
export interface EventMetadata {
    readonly taskId?: TaskId;
    readonly subtaskId?: EntityId;
    readonly employeeId?: EntityId;
    readonly projectId?: EntityId;
    readonly sessionId?: EntityId;
    readonly modelId?: ModelId;
    readonly runtimeId?: RuntimeId;
    readonly actor?: EventActor;
}
/** JSON-safe, secret-free payload (redaction is applied before publish). */
export type EventPayload = Readonly<Record<string, unknown>>;
/**
 * Known lifecycle event types (open-ended: new names may be registered
 * without re-versioning the envelope).
 */
export type KnownEventType = "task_created" | "task_status_changed" | "task_cancelled" | "subtask_started" | "subtask_status_changed" | "plan_revised" | "usage_recorded" | "validation_completed" | "artifact_registered" | "context_trimmed" | "model_escalated" | "session_opened" | "session_continued" | "session_closed" | "session_recovered" | "employee_registered" | "employee_updated" | "employee_deactivated" | "profession_registered" | "department_registered" | "registry_reindexed" | "project_resumed" | "project_paused" | "project_quota_exceeded" | "runtime_adapter_registered" | "runtime_adapter_unavailable" | "budget_guard_rejected" | "resource_target_changed" | "queue_overflow" | "subscriber_failed" | "export_failed" | "archive_integrity";
export type EventType = KnownEventType | (string & {});
/** Envelope base: identity, type, ordering time, schema version. */
export interface DomainEvent {
    readonly id: EventId;
    readonly type: EventType;
    readonly ts: Timestamp;
    /** Envelope schema version (starts at 1). */
    readonly schemaVersion: number;
}
/** Full persistable envelope used by the C06 event bus. */
export interface EventEnvelope extends DomainEvent {
    readonly metadata: EventMetadata;
    readonly payload: EventPayload;
}
/** Alias kept for the documents and existing naming convention (C06/C14). */
export type OfficeEvent = EventEnvelope;
/** Current envelope schema version produced by publishers. */
export declare const EVENT_SCHEMA_VERSION = 1;
/** Validates and rebuilds an envelope (durable-first writers use it on intake). */
export declare function createEventEnvelope(input: {
    id: string;
    type: EventType;
    ts: string;
    metadata?: EventMetadata;
    payload?: EventPayload;
}): EventEnvelope;
