import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArchiveConflictError, ArchiveEventConflictError, ArchivePathError, createArchive } from "../src/index";

async function vault() { return mkdtemp(join(tmpdir(), "oao-archive-")); }
const now = "2026-11-05T12:00:00.000Z";

describe("MarkdownArchive", () => {
  it("creates a vault and persists projects, tasks, employees, decisions and reports", async () => {
    const archive = createArchive({ vaultRoot: await vault() });
    await archive.createProject({ projectId: "project-а", title: "Проект офиса", status: "active", createdAt: now, updatedAt: now });
    await archive.upsertTask({ taskId: "task-1", projectId: "project-а", title: "Задача", status: "running", createdAt: now, updatedAt: now, employeeId: "dev", runtimeId: "fake", modelId: "model" });
    await archive.upsertEmployee({ employeeId: "dev", name: "Разработчик", updatedAt: now });
    await archive.recordDecision({ decisionId: "dec-1", projectId: "project-а", title: "Решение", body: "Используем Markdown", createdAt: now });
    await archive.recordReport({ reportId: "rep-1", projectId: "project-а", title: "Отчёт", body: "Готово", createdAt: now });
    await archive.recordArtifact({ artifactId: "artifact-1", projectId: "project-а", taskId: "task-1", path: "artifacts/result.txt", createdAt: now });
    expect((await archive.getProject("project-а"))?.title).toBe("Проект офиса");
    expect((await archive.getDecisions("project-а"))).toHaveLength(1);
    expect((await archive.getReports("project-а"))).toHaveLength(1);
    expect((await archive.getArtifacts("project-а"))).toHaveLength(1);
  });

  it("records events idempotently and supports task/project reads after restart", async () => {
    const root = await vault();
    const event = { eventId: "event-1", timestamp: now, type: "task_completed", projectId: "p1", taskId: "t1", payload: { ok: true } };
    const first = createArchive({ vaultRoot: root });
    expect((await first.appendEvent(event)).recorded).toBe(true);
    expect((await first.recordEvent(event)).recorded).toBe(false);
    const restarted = createArchive({ vaultRoot: root });
    expect(await restarted.getTaskHistory("p1", "t1")).toHaveLength(1);
    expect(await restarted.getProjectEvents("p1")).toHaveLength(1);
  });

  it("isolates projects and serializes concurrent writes", async () => {
    const archive = createArchive({ vaultRoot: await vault() });
    await Promise.all(Array.from({ length: 20 }, (_, i) => archive.recordEvent({ eventId: `e-${i}`, timestamp: now, type: "progress", projectId: i % 2 ? "p1" : "p2", payload: { i } })));
    expect(await archive.getProjectEvents("p1")).toHaveLength(10);
    expect(await archive.getProjectEvents("p2")).toHaveLength(10);
  });

  it("redacts secrets and omits prompts from markdown", async () => {
    const root = await vault();
    const archive = createArchive({ vaultRoot: root });
    await archive.recordEvent({ eventId: "secret", timestamp: now, type: "error", projectId: "p", payload: { apiKey: "abc", prompt: "do not archive", message: "Bearer super-secret" } });
    const text = await readFile(join(root, "Events", "2026-11-05", "secret.md"), "utf8");
    expect(text).not.toContain("abc");
    expect(text).not.toContain("do not archive");
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("[OMITTED]");
  });

  it("treats an eventId reused by another project as a conflict", async () => {
    const archive = createArchive({ vaultRoot: await vault() });
    expect((await archive.recordEvent({ eventId: "global-id", timestamp: now, type: "x", projectId: "p1" })).recorded).toBe(true);
    await expect(archive.recordEvent({ eventId: "global-id", timestamp: now, type: "x", projectId: "p2" })).rejects.toBeInstanceOf(ArchiveEventConflictError);
    expect(await archive.getProjectEvents("p2")).toHaveLength(0);
  });

  it("rejects conflicting event data after restart and exposes the conflict", async () => {
    const root = await vault();
    const first = createArchive({ vaultRoot: root });
    await first.recordEvent({ eventId: "conflict", timestamp: now, type: "started", projectId: "p1", payload: { value: 1 } });
    const restarted = createArchive({ vaultRoot: root });
    await expect(restarted.recordEvent({ eventId: "conflict", timestamp: now, type: "started", projectId: "p1", payload: { value: 2 } })).rejects.toBeInstanceOf(ArchiveEventConflictError);
    const recovery = await restarted.getRecoveryMetadata();
    expect(recovery.conflicts).toHaveLength(1);
    expect(recovery.conflicts[0]?.eventId).toBe("conflict");
  });

  it("preserves task lifecycle history and reports incomplete tasks", async () => {
    const root = await vault();
    const archive = createArchive({ vaultRoot: root });
    const base = { taskId: "task", projectId: "p", title: "Task", createdAt: now, employeeId: "dev" };
    await archive.upsertTask({ ...base, status: "queued", updatedAt: now });
    await archive.upsertTask({ ...base, status: "running", updatedAt: "2026-11-05T12:01:00Z" });
    await archive.upsertTask({ ...base, status: "completed", updatedAt: "2026-11-05T12:02:00Z" });
    await archive.upsertTask({ ...base, status: "completed", updatedAt: "2026-11-05T12:02:00Z" });
    const history = await archive.getTaskHistory("p", "task");
    expect(history.map((event) => event.payload?.status)).toEqual(["queued", "running", "completed"]);
    expect((await archive.getRecoveryMetadata()).incompleteTasks).toHaveLength(0);
  });

  it("serializes concurrent task updates without losing transitions", async () => {
    const archive = createArchive({ vaultRoot: await vault() });
    await Promise.all(Array.from({ length: 10 }, (_, i) => archive.upsertTask({
      taskId: "concurrent", projectId: "p", title: "Concurrent", status: `phase-${i}`,
      createdAt: now, updatedAt: `2026-11-05T12:${String(i).padStart(2, "0")}:00Z`,
    })));
    expect(await archive.getTaskHistory("p", "concurrent")).toHaveLength(10);
    expect((await archive.getProjectEvents("p")).filter((event) => event.taskId === "concurrent")).toHaveLength(10);
  });

  it("detects incomplete tasks, corrupt markdown and orphaned temp files", async () => {
    const root = await vault();
    const archive = createArchive({ vaultRoot: root });
    await archive.upsertTask({ taskId: "open", projectId: "p", title: "Open", status: "running", createdAt: now, updatedAt: now });
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(root, "Projects", "p", "Tasks", "broken.md"), "<!-- oao-archive-managed -->\n---\nstatus: {bad\n---\n", "utf8");
    await fs.writeFile(join(root, "Projects", "p", "Tasks", "broken.md.temporary.tmp"), "partial", "utf8");
    const recovery = await archive.getRecoveryMetadata();
    expect(recovery.incompleteTasks.map((task) => task.taskId)).toContain("open");
    expect(recovery.readErrors.some((error) => error.path.endsWith("broken.md"))).toBe(true);
    expect(recovery.orphanedTempFiles.some((path) => path.endsWith(".tmp"))).toBe(true);
  });

  it("rejects invalid timestamps and retains project isolation", async () => {
    const archive = createArchive({ vaultRoot: await vault() });
    await expect(archive.recordEvent({ eventId: "bad", timestamp: "not-a-date", type: "x", projectId: "p1" })).rejects.toThrow("Invalid event timestamp");
    await archive.recordEvent({ eventId: "p1-event", timestamp: now, type: "x", projectId: "p1" });
    await archive.recordEvent({ eventId: "p2-event", timestamp: now, type: "x", projectId: "p2" });
    expect((await archive.getProjectEvents("p1")).map((event) => event.eventId)).toEqual(["p1-event"]);
  });

  it("rejects traversal, symlink escape and foreign-file overwrite", async () => {
    const root = await vault();
    const archive = createArchive({ vaultRoot: root });
    await expect(archive.createProject({ projectId: "../outside", title: "x", createdAt: now, updatedAt: now })).rejects.toBeInstanceOf(ArchivePathError);
    const outside = await vault();
    await symlink(outside, join(root, "Projects"));
    await expect(archive.createProject({ projectId: "p", title: "x", createdAt: now, updatedAt: now })).rejects.toBeInstanceOf(ArchivePathError);
    const safeRoot = await vault();
    const foreign = join(safeRoot, "Projects", "p", "index.md");
    await (await import("node:fs/promises")).mkdir(join(safeRoot, "Projects", "p"), { recursive: true });
    await writeFile(foreign, "# user note\n", "utf8");
    await expect(createArchive({ vaultRoot: safeRoot }).createProject({ projectId: "p", title: "x", createdAt: now, updatedAt: now })).rejects.toBeInstanceOf(ArchiveConflictError);
  });

  it("keeps atomic writes recoverable when a managed file is updated", async () => {
    const root = await vault();
    const archive = createArchive({ vaultRoot: root });
    await archive.createProject({ projectId: "p", title: "old", createdAt: now, updatedAt: now });
    await archive.createProject({ projectId: "p", title: "new", createdAt: now, updatedAt: now });
    expect((await archive.getProject("p"))?.title).toBe("new");
  });
});
