import type { CashPayment, TaskBudgetRequest, UsageEventInput, UsageRecord } from "./types.js";

/** Identifiers: 1-128 chars, letter/digit first, then letters, digits, '.', '_', ':', '-'. */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** ISO 8601 date-time with mandatory time and explicit zone (Z or +hh:mm). */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

export const USAGE_METRIC_NAMES = ["input", "output", "reasoning", "cacheRead", "cacheWrite", "total", "costUsd"] as const;
/** Every field a persisted UsageRecord may contain. Anything else is not stored. */
export const USAGE_RECORD_KEYS = ["eventId", "agentId", "modelId", "taskId", "projectId", "sessionId", "timestamp", ...USAGE_METRIC_NAMES] as const;

export function assertIdentifier(field: string, value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${field} must be 1-128 characters: letters, digits, '.', '_', ':', '-'`);
  }
  return value;
}

export function assertOptionalIdentifier(field: string, value: unknown): string | undefined {
  return value === undefined ? undefined : assertIdentifier(field, value);
}

export function assertNonEmptyString(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

export function assertNonNegativeNumber(field: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be a non-negative finite number`);
  return value;
}

export function assertBoolean(field: string, value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`);
  return value;
}

export function assertOptionalStringIn<S extends string>(field: string, value: unknown, variants: readonly S[]): S | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(variants as readonly string[]).includes(value)) {
    throw new TypeError(`${field} must be one of: ${variants.join(", ")}`);
  }
  return value as S;
}

/** Returns the timestamp as normalized ISO UTC string; rejects anything that is not an ISO date-time. */
export function normalizeTimestamp(field: string, value: unknown): string {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) throw new TypeError(`${field} must be an ISO 8601 date-time with time zone`);
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) throw new TypeError(`${field} must be a valid date`);
  return new Date(epochMs).toISOString();
}

export function normalizeUsageInput(input: UsageEventInput): UsageEventInput {
  assertIdentifier("agentId", input.agentId);
  assertIdentifier("taskId", input.taskId);
  assertNonEmptyString("modelId", input.modelId);
  for (const metric of USAGE_METRIC_NAMES) assertNonNegativeNumber(`usage.${metric}`, input[metric]);
  const normalized: UsageEventInput = { ...input };
  if (input.eventId !== undefined) normalized.eventId = assertIdentifier("eventId", input.eventId);
  if (input.projectId !== undefined) normalized.projectId = assertIdentifier("projectId", input.projectId);
  if (input.sessionId !== undefined) normalized.sessionId = assertIdentifier("sessionId", input.sessionId);
  if (input.timestamp !== undefined) normalized.timestamp = normalizeTimestamp("usage.timestamp", input.timestamp);
  return normalized;
}

/**
 * Validates a usage record read from or about to be written to the journal.
 * With `allowUnknownFields` unknown keys are dropped (write path, so arbitrary
 * caller data is never persisted); otherwise they make the record invalid (read path).
 */
export function parseUsageRecord(value: unknown, options: { allowUnknownFields?: boolean } = {}): UsageRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("usage record must be an object");
  const raw = value as Record<string, unknown>;
  if (!options.allowUnknownFields) {
    for (const key of Object.keys(raw)) {
      if (!(USAGE_RECORD_KEYS as readonly string[]).includes(key)) throw new TypeError(`usage record has unknown field ${key}`);
    }
  }
  const record: UsageRecord = {
    eventId: assertIdentifier("eventId", raw.eventId),
    agentId: assertIdentifier("agentId", raw.agentId),
    modelId: assertNonEmptyString("modelId", raw.modelId),
    taskId: assertIdentifier("taskId", raw.taskId),
    timestamp: normalizeTimestamp("timestamp", raw.timestamp),
    input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0,
  };
  const projectId = assertOptionalIdentifier("projectId", raw.projectId);
  const sessionId = assertOptionalIdentifier("sessionId", raw.sessionId);
  if (projectId !== undefined) record.projectId = projectId;
  if (sessionId !== undefined) record.sessionId = sessionId;
  for (const metric of USAGE_METRIC_NAMES) record[metric] = assertNonNegativeNumber(metric, raw[metric]);
  return record;
}

/** Non-throwing variant used when reading journal lines. */
export function tryParseUsageRecord(value: unknown): UsageRecord | undefined {
  try {
    return parseUsageRecord(value);
  } catch {
    return undefined;
  }
}

/** Field-by-field equality of two normalized usage records. */
export function sameUsageRecord(a: UsageRecord, b: UsageRecord): boolean {
  return USAGE_RECORD_KEYS.every((key) => a[key] === b[key]);
}

export function normalizeTaskRequest(request: TaskBudgetRequest): TaskBudgetRequest {
  assertIdentifier("taskId", request.taskId);
  assertIdentifier("agentId", request.agentId);
  if (request.modelId !== undefined) assertNonEmptyString("modelId", request.modelId);
  if (request.projectId !== undefined) assertIdentifier("projectId", request.projectId);
  if (request.sessionId !== undefined) assertIdentifier("sessionId", request.sessionId);
  for (const field of ["estimatedCostUsd", "estimatedTotalTokens", "estimatedOutputTokens", "estimatedReasoningTokens", "estimatedDurationMs"] as const) {
    const value = request[field];
    if (value !== undefined) assertNonNegativeNumber(field, value);
  }
  if (request.requiresExtraSpend !== undefined && typeof request.requiresExtraSpend !== "boolean") {
    throw new TypeError("requiresExtraSpend must be a boolean");
  }
  const normalized: TaskBudgetRequest = { ...request };
  if (request.startedAt !== undefined) normalized.startedAt = normalizeTimestamp("startedAt", request.startedAt);
  return normalized;
}

/** Whitelists persisted fields: description and any other extra fields are never stored. */
export function normalizeCashPayment(payment: CashPayment): CashPayment {
  assertIdentifier("paymentId", payment.paymentId);
  const amountRub = assertNonNegativeNumber("amountRub", payment.amountRub);
  const timestamp = normalizeTimestamp("timestamp", payment.timestamp);
  return { paymentId: payment.paymentId, amountRub, timestamp };
}

/** Non-throwing variant used when reading journal lines. */
export function tryNormalizeCashPayment(value: unknown): CashPayment | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    return normalizeCashPayment(value as CashPayment);
  } catch {
    return undefined;
  }
}

export function samePayment(a: CashPayment, b: CashPayment): boolean {
  return a.paymentId === b.paymentId && a.amountRub === b.amountRub && a.timestamp === b.timestamp;
}
