# Archive

`@open-agent-office/archive` is a dependency-free, local Markdown archive for
the Obsidian-compatible project history. `vaultRoot` is always explicit; the
package never discovers or writes to a user's Obsidian vault implicitly.

```ts
const archive = createArchive({ vaultRoot: "/data/oao-vault" });
await archive.upsertTask({
  taskId: "task-1", projectId: "project-1", title: "Inspect runtime",
  status: "running", createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(), employeeId: "developer",
});
await archive.recordEvent({
  eventId: "event-1", timestamp: new Date().toISOString(),
  type: "task_started", projectId: "project-1", taskId: "task-1",
  payload: { phase: "execution" },
});
await archive.recordArtifact({
  artifactId: "artifact-1", projectId: "project-1", taskId: "task-1",
  path: "artifacts/result.txt", createdAt: new Date().toISOString(),
});
```

The resulting vault contains `Projects/<projectId>/index.md`, project-scoped
`Tasks`, `Decisions` and `Reports`, global `Employees`, and globally unique
`Events/YYYY-MM-DD/<eventId>.md`. Event reads filter by project/task metadata.

Writes are serialized within one `MarkdownArchive` instance, use a temporary
file plus atomic rename, reject symlink escapes and refuse to overwrite files
without the archive marker. This is intentionally a single-writer primitive;
it does not claim cross-process locking or provide the SQLite event store and
transactional outbox required by the full C14 architecture. A future adapter
can subscribe `ExecutionCoordinator.onEvent` to `recordEvent` and call
`upsertTask` from the server task lifecycle without changing this package.
