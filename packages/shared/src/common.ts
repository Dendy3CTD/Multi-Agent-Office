/**
 * Common cross-domain types: identifiers, timestamps, result protocol and
 * error codes. This module imports nothing from the rest of the package.
 */

export declare const ENTITY_ID_BRAND: unique symbol;

/** Any MAO entity identifier (task, employee, project, event, ...). */
export type EntityId = string & { readonly [ENTITY_ID_BRAND]?: "EntityId" };

export type TaskId = EntityId;
export type SubtaskId = EntityId;
export type EmployeeId = EntityId;
export type ProfessionId = EntityId;
export type DepartmentId = EntityId;
export type ProjectId = EntityId;
export type SessionId = EntityId;
export type EventId = EntityId;
export type SkillId = EntityId;
export type ModelId = EntityId;
export type RuntimeId = EntityId;
export type ProviderId = EntityId;
export type ArtifactId = EntityId;

/** ISO 8601 timestamp with time zone (e.g. `2026-11-04T12:00:00.000Z`). */
export type Timestamp = string & { readonly [ENTITY_ID_BRAND]?: "Timestamp" };

/** Structured success/failure without exceptions. */
export type Result<TValue, TError = ValidationError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError };

/** Stable string codes for machine-readable failures. */
export type ErrorCode =
  | "validation_error"
  | "not_found"
  | "identifier_conflict"
  | "budget_exceeded"
  | "budget_blocked"
  | "concurrency_limit"
  | "runtime_unavailable"
  | "runtime_failed"
  | "unsupported_capability"
  | "cancelled"
  | "internal_error"
  | (string & {});

export interface ValidationError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly field?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Window-based listing parameters (from = first item index). */
export interface Pagination {
  readonly limit: number;
  readonly offset: number;
}

export interface Paginated<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** Builds a `Paginated` view over an already sliced array. */
export function paginate<TItem>(items: readonly TItem[], total: number, pagination: Pagination): Paginated<TItem> {
  return { items, total, limit: pagination.limit, offset: pagination.offset };
}

/** Creates a structured {@link ValidationError}. */
export function validationError(message: string, options: { code?: ErrorCode; field?: string; details?: Readonly<Record<string, unknown>> } = {}): ValidationError {
  return { code: options.code ?? "validation_error", message, field: options.field, details: options.details };
}
