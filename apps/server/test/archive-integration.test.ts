import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createArchive, type Archive } from "@open-agent-office/archive";
import { createDefaultMaoServer } from "../src/defaults.js";
import { DeliveryJournal } from "../src/delivery-journal.js";

async function request(app: Awaited<ReturnType<typeof createDefaultMaoServer>>, path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  const headers = { authorization: "Bearer archive-token", ...(init.headers ?? {}) };
  const body = init.body;
  return app.app.dispatch({ method: init.method ?? "GET", url: path, headers, [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(body); } } as never);
}

async function waitForCompletion(app: Awaited<ReturnType<typeof createDefaultMaoServer>>, id: string) {
  for (let i = 0; i < 30; i += 1) {
    const response = await request(app, `/v1/tasks/${id}`);
    const body = response.body as { status: string };
    if (["completed", "failed", "cancelled"].includes(body.status)) return body;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error("task did not complete");
}

const project = { id: "archive-project", name: "Archive project", rootDir: "/tmp/archive-project", status: "active", portfolio: { priority: "normal", budgetShare: 1, maxConcurrentExecutions: 2 } };

describe("server MarkdownArchive integration", () => {
  it("keeps archive optional and reports invalid configured roots", async () => {
    const disabled = await createDefaultMaoServer({ token: "archive-token" });
    expect((await request(disabled, "/v1/status")).body).toMatchObject({ archive: { configured: false } });
    vi.stubEnv("MAO_ARCHIVE_ROOT", "/etc/mao-archive");
    const blocked = await createDefaultMaoServer({ token: "archive-token" });
    expect((await request(blocked, "/v1/status")).body).toMatchObject({ archive: { configured: false } });
    vi.unstubAllEnvs();
  });

  it("persists project, task lifecycle and deduplicated events, then reads them after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "oao-server-archive-"));
    const archive = createArchive({ vaultRoot: root });
    const first = await createDefaultMaoServer({ token: "archive-token", archive });
    expect((await request(first, "/v1/projects", { method: "POST", body: JSON.stringify(project), headers: { "content-type": "application/json" } })).status).toBe(201);
    const taskResponse = await request(first, "/v1/tasks", { method: "POST", body: JSON.stringify({ projectId: project.id, id: "archive-task", title: "Archive task", brief: "private prompt must not be archived" }), headers: { "content-type": "application/json", "idempotency-key": "archive-task-key" } });
    expect(taskResponse.status).toBe(202);
    expect((await waitForCompletion(first, "archive-task")).status).toBe("completed");
    await new Promise(resolve => setTimeout(resolve, 25));
    const events = await archive.getProjectEvents(project.id);
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining(["task_scheduled", "task_started", "task_completed", "resource_released"]));
    const eventIds = events.map(event => event.eventId);
    expect(new Set(eventIds).size).toBe(eventIds.length);
    const restarted = await createDefaultMaoServer({ token: "archive-token", archive });
    expect((await request(restarted, `/v1/archive/projects/${project.id}`)).body).toMatchObject({ project: { projectId: project.id, title: project.name } });
    expect((await request(restarted, `/v1/archive/tasks/archive-task/history`)).body).toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ taskId: "archive-task" })]) });
    expect((await request(restarted, `/v1/archive/projects/${project.id}/events`)).body).toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ taskId: "archive-task" })]) });
    expect(JSON.stringify(events)).not.toContain("private prompt must not be archived");
  });

  it("does not claim durable project creation when archive write fails", async () => {
    const failing = { createProject: async () => { throw new Error("disk unavailable"); } } as unknown as Archive;
    const app = await createDefaultMaoServer({ token: "archive-token", archive: failing });
    const response = await request(app, "/v1/projects", { method: "POST", body: JSON.stringify({ ...project, id: "archive-failure" }), headers: { "content-type": "application/json" } });
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ error: { code: "archive_unavailable" } });
  });

  it("replays an undelivered journal event during server construction", async () => {
    const root = await mkdtemp(join(tmpdir(), "oao-server-recovery-"));
    const journalPath = join(root, "delivery", "events.jsonl");
    const first = new DeliveryJournal(journalPath);
    await first.accept({ eventId: "restart-event", timestamp: "2026-11-05T12:00:00.000Z", type: "task_failed", projectId: "restart-project", taskId: "restart-task" });
    const archive = createArchive({ vaultRoot: join(root, "vault") });
    const restarted = await createDefaultMaoServer({ token: "archive-token", archive, deliveryJournal: new DeliveryJournal(journalPath) });
    expect((await request(restarted, "/v1/status")).body).toMatchObject({ archive: { delivery: { pendingDeliveries: 0, replayStatus: "complete" } } });
    expect(await archive.getProjectEvents("restart-project")).toHaveLength(1);
    await restarted.close();
  });
});
