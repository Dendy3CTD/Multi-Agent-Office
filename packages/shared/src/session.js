/**
 * Looks up an adapter-side session id inside an event envelope. Works
 * cross-runtime: it recognises the common key names produced by OpenCode
 * (`sessionId`, `opencodeSessionId`) and Codex (`externalSessionId`), never
 * by parsing terminal output.
 */
export function sessionIdFromEvent(event) {
    const candidates = [
        event.metadata.sessionId,
        directValue(event.payload, "sessionId"),
        directValue(event.payload, "externalSessionId"),
        directValue(event.payload, "opencodeSessionId"),
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.length > 0)
            return candidate;
    }
    return undefined;
}
function directValue(payload, key) {
    const value = payload[key];
    if (typeof value === "string")
        return value;
    const nested = payload["session"];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const nestedValue = nested[key];
        if (typeof nestedValue === "string")
            return nestedValue;
    }
    return undefined;
}
