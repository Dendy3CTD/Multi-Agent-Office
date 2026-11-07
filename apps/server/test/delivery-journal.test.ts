import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ArchiveEvent } from "@open-agent-office/archive";
import { DeliveryJournal } from "../src/delivery-journal.js";

const event: ArchiveEvent = { eventId: "event-1", timestamp: "2026-11-05T12:00:00.000Z", type: "task_started", projectId: "project-1", taskId: "task-1", payload: { attempt: 1, prompt: "never persist this", apiKey: "secret" } };

async function journalPath() { return join(await mkdtemp(join(tmpdir(), "oao-journal-")), "delivery.jsonl"); }

describe("durable delivery journal", () => {
  it("accepts, delivers once and redacts unsafe payload fields", async () => {
    const journal = new DeliveryJournal(await journalPath());
    await journal.accept(event);
    let calls = 0;
    await journal.deliver(async delivered => { calls += 1; expect(delivered.payload).toEqual({ attempt: 1 }); });
    expect(calls).toBe(1);
    expect(journal.diagnostics()).toMatchObject({ pendingDeliveries: 0, journalHealthy: true, lastSuccessfulDelivery: "event-1" });
  });

  it("deduplicates event submission and archive delivery failure remains pending", async () => {
    const journal = new DeliveryJournal(await journalPath());
    await Promise.all([journal.accept(event), journal.accept(event)]);
    let calls = 0;
    await journal.deliver(async () => { calls += 1; throw Object.assign(new Error("vault unavailable"), { code: "archive_unavailable" }); });
    expect(calls).toBe(1);
    expect(journal.diagnostics()).toMatchObject({ pendingDeliveries: 1, lastErrorCode: "archive_unavailable" });
  });

  it("replays undelivered records after restart and ignores a truncated tail", async () => {
    const path = await journalPath();
    const first = new DeliveryJournal(path);
    await first.accept(event);
    await appendFile(path, '{"kind":"event","version":1,"event":{"eventId":"truncated"');
    const restarted = new DeliveryJournal(path);
    const delivered: ArchiveEvent[] = [];
    await restarted.replay(async item => { delivered.push(item); });
    expect(delivered.map(item => item.eventId)).toEqual(["event-1"]);
    expect(restarted.diagnostics()).toMatchObject({ pendingDeliveries: 0, lastErrorCode: "journal_truncated_tail" });
  });

  it("recovers valid records around a corrupt line and reports corruption", async () => {
    const path = await journalPath();
    const line = `${JSON.stringify({ kind: "event", version: 1, event })}\n`;
    await writeFile(path, `${line}{not-json}\n`, "utf8");
    const journal = new DeliveryJournal(path);
    await journal.open();
    expect(journal.diagnostics()).toMatchObject({ pendingDeliveries: 1, journalHealthy: false, lastErrorCode: "journal_corrupt_record" });
  });

  it("reports journal write failure instead of claiming acceptance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oao-journal-file-"));
    const parent = join(directory, "parent");
    await writeFile(parent, "not a directory", "utf8");
    const journal = new DeliveryJournal(join(parent, "delivery.jsonl"));
    await expect(journal.accept(event)).rejects.toBeTruthy();
    expect(journal.diagnostics()).toMatchObject({ journalHealthy: false, lastErrorCode: expect.any(String) });
  });
});
