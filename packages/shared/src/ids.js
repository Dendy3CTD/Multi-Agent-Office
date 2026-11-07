import { validationError } from "./common.js";
/**
 * Canonical identifier rules consolidated from the three patterns that
 * already exist in the monorepo (budget-manager validation, orchestrator
 * coordinator, orchestrator agent model table). Entity ids: 1-128 chars,
 * letter/digit first. Model ids additionally carry a `provider/model` slash.
 */
/** Entity identifiers: 1-128 chars; letter/digit first, then letters, digits, '.', '_', ':', '-'. */
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Task identifiers keep the same shape as other entity ids. */
export const TASK_ID_PATTERN = IDENTIFIER_PATTERN;
/** Provider-qualified model ids: `provider/model`, e.g. `opencode-go/glm-5.3-flash`. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Runtime ids: short slug, e.g. `opencode` or `codex`. */
export const RUNTIME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** ISO 8601 date-time with mandatory time and explicit zone (Z or ±hh:mm). */
export const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
/** Asserts a valid {@link EntityId}/{@link TaskId}/... value; returns `value` unchanged. */
export function assertIdentifier(field, value) {
    if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
        throw new TypeError(`${field} must be 1-128 characters: letters, digits, '.', '_', ':', '-'`);
    }
    return value;
}
/** Asserts an optional identifier; `undefined` passes through. */
export function assertOptionalIdentifier(field, value) {
    return value === undefined ? undefined : assertIdentifier(field, value);
}
/** Asserts a provider-qualified model id in the canonical catalog format. */
export function assertModelId(field, value) {
    if (typeof value !== "string" || !MODEL_ID_PATTERN.test(value)) {
        throw new TypeError(`${field} must be a provider/model id (e.g. opencode-go/glm-5.3-flash)`);
    }
    return value;
}
/** Asserts a runtime id slug (`opencode`, `codex`, ...). */
export function assertRuntimeId(field, value) {
    if (typeof value !== "string" || !RUNTIME_ID_PATTERN.test(value)) {
        throw new TypeError(`${field} must be a short slug of 1-64 characters: letters, digits, '.', '_', '-'`);
    }
    return value;
}
/** Asserts an ISO 8601 timestamp and returns it normalized to ISO UTC. */
export function assertTimestamp(field, value) {
    if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) {
        throw new TypeError(`${field} must be an ISO 8601 date-time with an explicit time zone`);
    }
    const epochMs = Date.parse(value);
    if (!Number.isFinite(epochMs))
        throw new TypeError(`${field} must be a valid date`);
    return new Date(epochMs).toISOString();
}
/** Result-based variant of {@link assertIdentifier} (no exceptions). */
export function validateIdentifier(field, value) {
    try {
        return { ok: true, value: assertIdentifier(field, value) };
    }
    catch (error) {
        return { ok: false, error: validationError(error instanceof Error ? error.message : String(error), { field }) };
    }
}
/** Result-based variant of {@link assertTimestamp}; returns a normalized {@link Timestamp}. */
export function validateTimestamp(field, value) {
    try {
        return { ok: true, value: assertTimestamp(field, value) };
    }
    catch (error) {
        return { ok: false, error: validationError(error instanceof Error ? error.message : String(error), { field }) };
    }
}
