import { type EntityId, type Timestamp, validationError } from "./common.js";
/**
 * Canonical identifier rules consolidated from the three patterns that
 * already exist in the monorepo (budget-manager validation, orchestrator
 * coordinator, orchestrator agent model table). Entity ids: 1-128 chars,
 * letter/digit first. Model ids additionally carry a `provider/model` slash.
 */
/** Entity identifiers: 1-128 chars; letter/digit first, then letters, digits, '.', '_', ':', '-'. */
export declare const IDENTIFIER_PATTERN: RegExp;
/** Task identifiers keep the same shape as other entity ids. */
export declare const TASK_ID_PATTERN: RegExp;
/** Provider-qualified model ids: `provider/model`, e.g. `opencode-go/glm-5.3-flash`. */
export declare const MODEL_ID_PATTERN: RegExp;
/** Runtime ids: short slug, e.g. `opencode` or `codex`. */
export declare const RUNTIME_ID_PATTERN: RegExp;
/** ISO 8601 date-time with mandatory time and explicit zone (Z or ±hh:mm). */
export declare const ISO_TIMESTAMP_PATTERN: RegExp;
/** Asserts a valid {@link EntityId}/{@link TaskId}/... value; returns `value` unchanged. */
export declare function assertIdentifier(field: string, value: unknown): string;
/** Asserts an optional identifier; `undefined` passes through. */
export declare function assertOptionalIdentifier(field: string, value: unknown): string | undefined;
/** Asserts a provider-qualified model id in the canonical catalog format. */
export declare function assertModelId(field: string, value: unknown): string;
/** Asserts a runtime id slug (`opencode`, `codex`, ...). */
export declare function assertRuntimeId(field: string, value: unknown): string;
/** Asserts an ISO 8601 timestamp and returns it normalized to ISO UTC. */
export declare function assertTimestamp(field: string, value: unknown): string;
/** Result-based variant of {@link assertIdentifier} (no exceptions). */
export declare function validateIdentifier(field: string, value: unknown): {
    ok: true;
    value: EntityId;
} | {
    ok: false;
    error: ReturnType<typeof validationError>;
};
/** Result-based variant of {@link assertTimestamp}; returns a normalized {@link Timestamp}. */
export declare function validateTimestamp(field: string, value: unknown): {
    ok: true;
    value: Timestamp;
} | {
    ok: false;
    error: ReturnType<typeof validationError>;
};
