import { type EntityId, type RuntimeId, type Timestamp } from "./common.js";
/**
 * Session types (C10). A session belongs to an employee and a project
 * context; the binding to a concrete Runtime adapter is a separate record
 * that can be re-created between executions (ADR-MAO-010/011).
 */
export type SessionStatus = "open" | "closed" | "recovered" | "detached";
/** A continuous working context of one employee inside one project. */
export interface EmployeeSession {
    readonly id: EntityId;
    readonly employeeId: EntityId;
    readonly projectId: EntityId;
    readonly status: SessionStatus;
    readonly openedAt: Timestamp;
    readonly closedAt?: Timestamp;
}
/** Reference to context material inside the session scope (kept shallow, redacted). */
export interface SessionContextReference {
    readonly sessionId: EntityId;
    readonly kind: "memory" | "artifact" | "event" | "excerpt";
    readonly projectId: EntityId;
    readonly reference: string;
}
/**
 * Binding of an open session to an adapter-side conversation id. Re-binding
 * to another Runtime never rewrites the employee identity or the session
 * identity; it records a new row.
 */
export interface RuntimeSessionBinding {
    readonly sessionId: EntityId;
    readonly runtimeId: RuntimeId;
    readonly externalSessionId: string;
    readonly status: "bound" | "detached";
    readonly boundAt: Timestamp;
    /** Whether the adapter declared `sessionResume` at bind time. */
    readonly resumable: boolean;
}
