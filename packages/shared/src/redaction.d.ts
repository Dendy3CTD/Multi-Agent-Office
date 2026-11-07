declare const REDACTED = "[REDACTED]";
declare const SENSITIVE_KEY: RegExp;
/**
 * Replaces known credential patterns inside a free-form string.
 * Semantics are parity-identical to `runtime-opencode` (the owner of the
 * original implementation); the single canonical module lives here and
 * runtime packages re-export it for backwards compatibility (see
 * IMPLEMENTATION_MAP M-01 / API_CONTRACTS §1).
 */
export declare function redactSecrets(value: string): string;
/**
 * Deep-sanitizes an arbitrary (JSON-safe) value: sensitive *keys* collapse
 * to `[REDACTED]`, string leaves go through {@link redactSecrets}.
 */
export declare function sanitizeValue(value: unknown, key?: string): unknown;
/** The placeholder marker produced by both helpers. */
export declare const REDACTION_MARKER: typeof REDACTED;
export { SENSITIVE_KEY as REDACTION_SENSITIVE_KEY };
