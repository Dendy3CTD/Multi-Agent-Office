import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ArchiveEvent } from "@open-agent-office/archive";

const VERSION = 1;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

interface JournalEventRecord { readonly kind: "event"; readonly version: 1; readonly event: ArchiveEvent; }
interface JournalAckRecord { readonly kind: "ack"; readonly version: 1; readonly eventId: string; }
type JournalRecord = JournalEventRecord | JournalAckRecord;

export interface DeliveryJournalDiagnostics {
  readonly journalHealthy: boolean;
  readonly pendingDeliveries: number;
  readonly lastSuccessfulDelivery?: string;
  readonly lastErrorCode?: string;
  readonly replayStatus: "not_started" | "running" | "complete" | "failed";
}

function validEvent(event: ArchiveEvent): boolean {
  return typeof event.eventId === "string" && event.eventId.length > 0 && event.eventId.length < 512 && typeof event.timestamp === "string" && typeof event.type === "string" && event.type.length < 128 && (!event.projectId || typeof event.projectId === "string") && (!event.taskId || typeof event.taskId === "string");
}

export class DeliveryJournal {
  readonly filePath: string;
  private readonly pending = new Map<string, ArchiveEvent>();
  private tail: Promise<void> = Promise.resolve();
  private opened = false;
  private healthy = true;
  private lastSuccessful?: string;
  private lastErrorCode?: string;
  private replayState: DeliveryJournalDiagnostics["replayStatus"] = "not_started";
  private deliveryActive = false;
  private activeDelivery?: Promise<void>;

  constructor(filePath: string) { this.filePath = resolve(filePath); }

  async open(): Promise<void> {
    if (this.opened) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    let content = "";
    try {
      const info = await stat(this.filePath);
      if (info.size > MAX_FILE_BYTES) throw new Error("journal_too_large");
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { this.fail(error); throw error; }
    }
    this.recover(content);
    this.opened = true;
  }

  /** Submission is asynchronous because Coordinator's event callback is synchronous. */
  accept(event: ArchiveEvent): Promise<void> {
    if (!validEvent(event)) return Promise.reject(Object.assign(new Error("invalid journal event"), { code: "journal_invalid_event" }));
    return this.enqueue(async () => {
      await this.open();
      if (this.pending.has(event.eventId)) return;
      const safe = this.safeEvent(event);
      const record: JournalEventRecord = { kind: "event", version: VERSION, event: safe };
      await this.append(record);
      this.pending.set(event.eventId, safe);
    });
  }

  async deliver(deliverEvent: (event: ArchiveEvent) => Promise<void>): Promise<void> {
    if (this.activeDelivery) return this.activeDelivery;
    const operation = this.runDelivery(deliverEvent);
    this.activeDelivery = operation;
    try { await operation; } finally { if (this.activeDelivery === operation) this.activeDelivery = undefined; }
  }

  private async runDelivery(deliverEvent: (event: ArchiveEvent) => Promise<void>): Promise<void> {
    if (this.deliveryActive) return;
    this.deliveryActive = true;
    try {
    await this.open();
    const events = [...this.pending.entries()];
    for (const [eventId, event] of events) {
      try {
        await deliverEvent(structuredClone(event));
        await this.enqueue(async () => { await this.append({ kind: "ack", version: VERSION, eventId }); this.pending.delete(eventId); this.lastSuccessful = eventId; });
      } catch (error) {
        this.lastErrorCode = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "archive_delivery_error";
        break;
      }
    }
    } finally { this.deliveryActive = false; }
  }

  async replay(deliverEvent: (event: ArchiveEvent) => Promise<void>): Promise<void> {
    this.replayState = "running";
    try { await this.deliver(deliverEvent); this.replayState = this.pending.size === 0 ? "complete" : "failed"; } catch (error) { this.fail(error); this.replayState = "failed"; }
  }

  diagnostics(): DeliveryJournalDiagnostics { return { journalHealthy: this.healthy, pendingDeliveries: this.pending.size, lastSuccessfulDelivery: this.lastSuccessful, lastErrorCode: this.lastErrorCode, replayStatus: this.replayState }; }

  async close(): Promise<void> { await this.tail; await this.activeDelivery; }

  private enqueue(operation: () => Promise<void>): Promise<void> { const result = this.tail.then(operation, operation); this.tail = result.catch(error => { this.fail(error); }); return result; }
  private async append(record: JournalRecord): Promise<void> { const line = `${JSON.stringify(record)}\n`; if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) throw Object.assign(new Error("journal_record_too_large"), { code: "journal_record_too_large" }); await appendFile(this.filePath, line, { encoding: "utf8", mode: 0o600 }); }
  private safeEvent(event: ArchiveEvent): ArchiveEvent { return { eventId: event.eventId, timestamp: event.timestamp, type: event.type, projectId: event.projectId, taskId: event.taskId, employeeId: event.employeeId, runtimeId: event.runtimeId, modelId: event.modelId, payload: { ...(typeof event.payload?.attempt === "number" ? { attempt: event.payload.attempt } : {}), ...(typeof event.payload?.reason === "string" ? { reason: event.payload.reason.slice(0, 256) } : {}) } }; }
  private recover(content: string): void {
    const lines = content.split("\n");
    const hasPartialTail = lines.length > 1 && lines[lines.length - 1] !== "";
    const complete = hasPartialTail ? lines.slice(0, -1) : lines.slice(0, -1);
    if (hasPartialTail) this.lastErrorCode = "journal_truncated_tail";
    for (const line of complete) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as JournalRecord;
        if (record.version !== VERSION || (record.kind !== "event" && record.kind !== "ack")) throw new Error("journal_corrupt_record");
        if (record.kind === "event" && validEvent(record.event)) this.pending.set(record.event.eventId, structuredClone(record.event));
        else if (record.kind === "ack" && typeof record.eventId === "string") this.pending.delete(record.eventId);
        else throw new Error("journal_invalid_record");
      } catch { this.healthy = false; this.lastErrorCode = "journal_corrupt_record"; }
    }
  }
  private fail(error: unknown): void { this.healthy = false; this.lastErrorCode = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "journal_io_error"; }
}
