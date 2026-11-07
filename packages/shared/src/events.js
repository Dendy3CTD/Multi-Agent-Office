import { assertIdentifier, assertTimestamp } from "./ids.js";
/** Current envelope schema version produced by publishers. */
export const EVENT_SCHEMA_VERSION = 1;
/** Validates and rebuilds an envelope (durable-first writers use it on intake). */
export function createEventEnvelope(input) {
    const id = assertIdentifier("event.id", input.id);
    const ts = assertTimestamp("event.ts", input.ts);
    if (typeof input.type !== "string" || input.type.length === 0 || input.type.length > 128) {
        throw new TypeError("event.type must be a non-empty string of at most 128 characters");
    }
    return Object.freeze({
        id,
        type: input.type,
        ts,
        schemaVersion: EVENT_SCHEMA_VERSION,
        metadata: Object.freeze({ ...input.metadata }),
        payload: Object.freeze({ ...input.payload }),
    });
}
