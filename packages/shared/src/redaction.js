const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /^(?:authorization|api[_-]?key|access[_-]?token|token|password|secret)$/i;
/**
 * Replaces known credential patterns inside a free-form string.
 * Semantics are parity-identical to `runtime-opencode` (the owner of the
 * original implementation); the single canonical module lives here and
 * runtime packages re-export it for backwards compatibility (see
 * IMPLEMENTATION_MAP M-01 / API_CONTRACTS §1).
 */
export function redactSecrets(value) {
    return value
        .replace(/(\bAuthorization\s*:\s*Bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
        .replace(/(\bapi[_-]?key\s*[=:]\s*)(["']?)[^\s,"'`;}]+\2/gi, `$1${REDACTED}`)
        .replace(/(\baccess_token\s*[=:]\s*)(["']?)[^\s,"'`;}]+\2/gi, `$1${REDACTED}`)
        .replace(/("?(?:token|password|secret)"?\s*:\s*)"[^"]*"/gi, `$1"${REDACTED}"`)
        .replace(/(\b(?:token|password|secret)\s*[=:]\s*)(["']?)[^\s,"'`;}]+\2/gi, `$1${REDACTED}`);
}
/**
 * Deep-sanitizes an arbitrary (JSON-safe) value: sensitive *keys* collapse
 * to `[REDACTED]`, string leaves go through {@link redactSecrets}.
 */
export function sanitizeValue(value, key) {
    if (key && SENSITIVE_KEY.test(key))
        return REDACTED;
    if (typeof value === "string")
        return redactSecrets(value);
    if (Array.isArray(value))
        return value.map((item) => sanitizeValue(item));
    if (value instanceof Date)
        return value;
    if (typeof value !== "object" || value === null)
        return value;
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)]));
}
/** The placeholder marker produced by both helpers. */
export const REDACTION_MARKER = REDACTED;
export { SENSITIVE_KEY as REDACTION_SENSITIVE_KEY };
