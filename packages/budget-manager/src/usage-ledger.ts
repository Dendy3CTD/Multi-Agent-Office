import type { UsageFilter, UsageMetrics, UsageRecord, UsageSummary, UsageTotals } from "./types.js";

const zeroTotals = (): UsageTotals => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0, eventCount: 0 });

function add(target: UsageTotals, record: UsageMetrics): void {
  target.input += record.input;
  target.output += record.output;
  target.reasoning += record.reasoning;
  target.cacheRead += record.cacheRead;
  target.cacheWrite += record.cacheWrite;
  target.total += record.total;
  target.costUsd += record.costUsd;
  target.eventCount += 1;
}

function bucket(target: Record<string, UsageTotals>, key: string, record: UsageRecord): void {
  target[key] ??= zeroTotals();
  add(target[key], record);
}

function matches(record: UsageRecord, filter: UsageFilter = {}): boolean {
  if (filter.agentId && record.agentId !== filter.agentId) return false;
  if (filter.modelId && record.modelId !== filter.modelId) return false;
  if (filter.taskId && record.taskId !== filter.taskId) return false;
  if (filter.projectId && record.projectId !== filter.projectId) return false;
  if (filter.sessionId && record.sessionId !== filter.sessionId) return false;
  const time = Date.parse(record.timestamp);
  if (filter.from && time < Date.parse(filter.from)) return false;
  if (filter.to && time >= Date.parse(filter.to)) return false;
  return true;
}

export class UsageLedger {
  constructor(private readonly records: UsageRecord[] = []) {}

  add(record: UsageRecord): void {
    if (!this.records.some((existing) => existing.eventId === record.eventId)) this.records.push(record);
  }

  all(): UsageRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  summarize(filter: UsageFilter = {}): UsageSummary {
    const summary: UsageSummary = { ...zeroTotals(), byAgent: {}, byModel: {}, byTask: {}, byProject: {}, bySession: {}, byDay: {}, byMonth: {} };
    for (const record of this.records) {
      if (!matches(record, filter)) continue;
      add(summary, record);
      bucket(summary.byAgent, record.agentId, record);
      bucket(summary.byModel, record.modelId, record);
      bucket(summary.byTask, record.taskId, record);
      if (record.projectId) bucket(summary.byProject, record.projectId, record);
      if (record.sessionId) bucket(summary.bySession, record.sessionId, record);
      const day = record.timestamp.slice(0, 10);
      bucket(summary.byDay, day, record);
      bucket(summary.byMonth, day.slice(0, 7), record);
    }
    return summary;
  }
}
