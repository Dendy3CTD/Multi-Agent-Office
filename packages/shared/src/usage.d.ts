import { type EntityId, type ModelId, type Timestamp } from "./common.js";
/** Canonical usage metrics of one recorded execution (or a sum of them). */
export interface UsageMetrics {
    readonly input: number;
    readonly output: number;
    readonly reasoning: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
    /** Reported USD cost (runtime-reported; RUB accounting lives in C08). */
    readonly costUsd: number;
}
/** Aggregated usage across a set of records. */
export interface UsageTotals extends UsageMetrics {
    readonly eventCount: number;
}
/**
 * Durable usage record — the canonical mirror of a C08 JSONL ledger entry.
 * The recorded event id makes every downstream import idempotent.
 */
export interface UsageRecord extends UsageMetrics {
    readonly eventId: EntityId;
    readonly agentId: EntityId;
    readonly modelId: ModelId;
    readonly taskId: EntityId;
    readonly projectId?: EntityId;
    readonly sessionId?: EntityId;
    readonly timestamp: Timestamp;
}
