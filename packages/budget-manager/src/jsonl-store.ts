import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { BudgetStoreError, UsageEventConflictError } from "./errors.js";
import type { UsageRecord, UsageStore } from "./types.js";
import { parseUsageRecord, sameUsageRecord, tryParseUsageRecord } from "./validation.js";

interface UsagePathState {
  queue: Promise<void>;
  ready?: Promise<void>;
  records: Map<string, UsageRecord>;
}

/** Shared per resolved path, so several instances in one process use one queue and one index. */
const states = new Map<string, UsagePathState>();

function stateFor(path: string): UsagePathState {
  let state = states.get(path);
  if (!state) {
    state = { queue: Promise.resolve(), records: new Map() };
    states.set(path, state);
  }
  return state;
}

export function usageEventId(input: Omit<UsageRecord, "eventId"> & { eventId?: string }): string {
  if (input.eventId) return input.eventId;
  const canonical = JSON.stringify({ agentId: input.agentId, modelId: input.modelId, taskId: input.taskId, projectId: input.projectId ?? null, sessionId: input.sessionId ?? null, timestamp: input.timestamp, input: input.input, output: input.output, reasoning: input.reasoning, cacheRead: input.cacheRead, cacheWrite: input.cacheWrite, total: input.total, costUsd: input.costUsd });
  return createHash("sha256").update(canonical).digest("hex");
}

async function endsWithNewline(handle: FileHandle, size: number): Promise<boolean> {
  const byte = Buffer.alloc(1);
  const { bytesRead } = await handle.read(byte, 0, 1, size - 1);
  return bytesRead === 1 && byte[0] === 0x0a;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Makes a newly created file name durable. Opening a directory for fsync is not
 * supported on every platform, so failures here are ignored on purpose.
 */
async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    /* directory fsync is unsupported on this platform */
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Append-only JSONL usage journal (format: one UsageRecord per line).
 *
 * - Writes go through a FileHandle: a missing trailing LF from an interrupted write
 *   is repaired by starting the new record on a fresh line, so records are never glued.
 * - Every write is followed by fsync (handle.sync()).
 * - Directory is created with mode 0700 and journal with 0600 (best effort chmod
 *   for an existing file). Existing directories are not re-permissioned.
 * - Records are validated on read; damaged or invalid lines are skipped.
 * - The same eventId with identical data is a no-op; with different data it throws
 *   UsageEventConflictError. Two conflicting lines in the file also fail loading.
 * - Operations are serialized inside the current Node.js process only. There is no
 *   inter-process locking.
 */
export class JsonlUsageStore implements UsageStore {
  readonly path: string;
  private readonly state: UsagePathState;

  constructor(path: string) {
    if (typeof path !== "string" || !isAbsolute(path)) throw new TypeError("JSONL journal path must be absolute");
    this.path = resolve(path);
    this.state = stateFor(this.path);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.state.queue.then(operation, operation);
    this.state.queue = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  private ready(): Promise<void> {
    this.state.ready ??= this.loadJournal().catch((error: unknown) => {
      this.state.ready = undefined;
      throw error;
    });
    return this.state.ready;
  }

  private async loadJournal(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new BudgetStoreError("Unable to read usage journal", error);
    }
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // damaged line: skipped, never executed
      }
      const record = tryParseUsageRecord(parsed);
      if (!record) continue;
      const existing = this.state.records.get(record.eventId);
      if (!existing) {
        this.state.records.set(record.eventId, record);
      } else if (!sameUsageRecord(existing, record)) {
        throw new UsageEventConflictError(record.eventId, "has conflicting records in the journal");
      }
    }
  }

  async appendUsage(input: UsageRecord): Promise<boolean> {
    // Unknown fields are dropped here so arbitrary caller data is never persisted.
    const record = parseUsageRecord(input, { allowUnknownFields: true });
    return this.enqueue(async () => {
      await this.ready();
      const existing = this.state.records.get(record.eventId);
      if (existing) {
        if (sameUsageRecord(existing, record)) return false;
        throw new UsageEventConflictError(record.eventId);
      }
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const existed = await pathExists(this.path);
      const handle = await open(this.path, "a+", 0o600);
      try {
        const info = await handle.stat();
        if ((info.mode & 0o777) !== 0o600) await handle.chmod(0o600).catch(() => undefined);
        // A previous write may have been cut short; start on a fresh line so nothing is glued together.
        const separator = info.size > 0 && !(await endsWithNewline(handle, info.size)) ? "\n" : "";
        await handle.appendFile(`${separator}${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (!existed) await syncDirectory(dirname(this.path));
      this.state.records.set(record.eventId, record);
      return true;
    });
  }

  async readUsage(): Promise<UsageRecord[]> {
    return this.enqueue(async () => {
      await this.ready();
      return [...this.state.records.values()].map((record) => ({ ...record }));
    });
  }
}
