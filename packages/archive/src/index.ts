import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type ArchiveStatus = string;

export interface ProjectRecord {
  projectId: string;
  title: string;
  status?: ArchiveStatus;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface TaskRecord {
  taskId: string;
  projectId: string;
  title: string;
  status: ArchiveStatus;
  createdAt: string;
  updatedAt: string;
  employeeId?: string;
  runtimeId?: string;
  modelId?: string;
  [key: string]: unknown;
}

export interface EmployeeRecord {
  employeeId: string;
  name: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface DecisionRecord {
  decisionId: string;
  projectId: string;
  title: string;
  body: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface ReportRecord {
  reportId: string;
  projectId: string;
  title: string;
  body: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface ArtifactRecord {
  artifactId: string;
  projectId: string;
  taskId?: string;
  path: string;
  kind?: string;
  sha256?: string;
  producerEmployeeId?: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface ArchiveEvent {
  eventId: string;
  timestamp: string;
  type: string;
  projectId?: string;
  taskId?: string;
  employeeId?: string;
  runtimeId?: string;
  modelId?: string;
  payload?: Record<string, unknown>;
}

export interface ArchiveOptions {
  vaultRoot: string;
  clock?: () => Date;
}

export interface ArchiveReadError {
  path: string;
  code: string;
  message: string;
}

export interface ArchiveConflict {
  conflictId: string;
  eventId?: string;
  path: string;
  detectedAt: string;
  reason: string;
}

export interface ArchiveRecoveryMetadata {
  projects: ProjectRecord[];
  recentEvents: ArchiveEvent[];
  incompleteTasks: TaskRecord[];
  conflicts: ArchiveConflict[];
  readErrors: ArchiveReadError[];
  orphanedTempFiles: string[];
}

export interface Archive {
  createProject(record: ProjectRecord): Promise<ProjectRecord>;
  upsertTask(record: TaskRecord): Promise<TaskRecord>;
  upsertEmployee(record: EmployeeRecord): Promise<EmployeeRecord>;
  recordDecision(record: DecisionRecord): Promise<DecisionRecord>;
  recordReport(record: ReportRecord): Promise<ReportRecord>;
  recordEvent(event: ArchiveEvent): Promise<{ recorded: boolean; path: string }>;
  appendEvent(event: ArchiveEvent): Promise<{ recorded: boolean; path: string }>;
  recordArtifact(record: ArtifactRecord): Promise<ArtifactRecord>;
  getProject(projectId: string): Promise<ProjectRecord | undefined>;
  getTaskHistory(projectId: string, taskId: string): Promise<ArchiveEvent[]>;
  getProjectEvents(projectId: string): Promise<ArchiveEvent[]>;
  getDecisions(projectId: string): Promise<DecisionRecord[]>;
  getReports(projectId: string): Promise<ReportRecord[]>;
  getArtifacts(projectId: string): Promise<ArtifactRecord[]>;
  getRecent(limit?: number): Promise<Array<ProjectRecord | TaskRecord | EmployeeRecord | DecisionRecord | ReportRecord | ArchiveEvent>>;
  getRecoveryMetadata(limit?: number): Promise<ArchiveRecoveryMetadata>;
}

export class ArchiveConflictError extends Error {
  constructor(path: string) {
    super(`Archive file is not managed by Open Agent Office: ${path}`);
    this.name = "ArchiveConflictError";
  }
}

export class ArchivePathError extends Error {
  constructor(value: string) {
    super(`Unsafe archive path segment: ${value}`);
    this.name = "ArchivePathError";
  }
}

export class ArchiveEventConflictError extends Error {
  readonly eventId: string;
  constructor(eventId: string, path: string) {
    super(`Conflicting archive eventId ${eventId} already exists at ${path}`);
    this.name = "ArchiveEventConflictError";
    this.eventId = eventId;
  }
}

export class ArchiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveValidationError";
  }
}

export class ArchiveCorruptionError extends Error {
  constructor(path: string) {
    super(`Corrupted managed archive file: ${path}`);
    this.name = "ArchiveCorruptionError";
  }
}

const MANAGED = "<!-- oao-archive-managed -->";
const REDACTED = "[REDACTED]";
const OMITTED = "[OMITTED]";
const SECRET_KEY = /(token|secret|password|credential|api.?key|cookie|private.?key|authorization|session)/i;
const PRIVATE_CONTENT_KEY = /^(prompt|raw(?:prompt|result|output)|result|output|stack|credentials?|environment|env)$/i;

function segment(value: string): string {
  if (!value || value.length > 128 || value === "." || value === ".." || isAbsolute(value) || value.includes("/") || value.includes("\\") || value.includes("\0") || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ArchivePathError(value);
  }
  const safe = value.replace(/[^\p{L}\p{N}._-]/gu, "_");
  if (!safe || safe === "." || safe === "..") throw new ArchivePathError(value);
  return safe;
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) throw new ArchiveValidationError(`Invalid ${field} timestamp`);
  return parsed.toISOString();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function safeValue(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (PRIVATE_CONTENT_KEY.test(key)) return OMITTED;
  if (depth > 5) return "[DEPTH_LIMIT]";
  if (typeof value === "string") {
    return value.replace(/(bearer\s+|api[_-]?key\s*[:=]\s*|password\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeValue(item, key, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) result[childKey] = safeValue(childValue, childKey, depth + 1);
    return result;
  }
  return value;
}

function yamlScalar(value: unknown): string {
  return JSON.stringify(safeValue(value));
}

function persistedValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(safeValue(value)));
}

function frontmatter(record: Record<string, unknown>): string {
  const lines = Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${yamlScalar(value)}`);
  return `---\n${lines.join("\n")}\n---`;
}

function markdown(record: Record<string, unknown>, title: string, body = ""): string {
  return `${MANAGED}\n${frontmatter(record)}\n\n# ${String(safeValue(title)).replace(/[\r\n]+/g, " ")}\n\n${body.replace(/\0/g, "")}`;
}

function parseFrontmatter(text: string, strict = false): Record<string, unknown> {
  const match = /^(?:<!-- oao-archive-managed -->\n)?---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) {
    if (strict && text.startsWith(MANAGED)) throw new ArchiveValidationError("Malformed archive frontmatter");
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    try { result[key] = JSON.parse(line.slice(separator + 1).trim()); } catch (error) {
      if (strict) throw new ArchiveValidationError(`Invalid archive metadata field: ${key}`);
    }
  }
  return result;
}

function eventFrom(text: string): ArchiveEvent | undefined {
  const record = parseFrontmatter(text);
  if (typeof record.eventId !== "string" || typeof record.timestamp !== "string" || typeof record.type !== "string") return undefined;
  return record as unknown as ArchiveEvent;
}

export class MarkdownArchive implements Archive {
  readonly vaultRoot: string;
  private readonly clock: () => Date;
  private writeTail: Promise<void> = Promise.resolve();
  private rootReady?: Promise<void>;

  constructor(options: ArchiveOptions) {
    this.vaultRoot = resolve(options.vaultRoot);
    this.clock = options.clock ?? (() => new Date());
  }

  async createProject(record: ProjectRecord): Promise<ProjectRecord> {
    segment(record.projectId); timestamp(record.createdAt, "createdAt"); timestamp(record.updatedAt, "updatedAt");
    return this.write(() => this.writeRecord(join("Projects", segment(record.projectId), "index.md"), record, record.title));
  }

  async upsertTask(record: TaskRecord): Promise<TaskRecord> {
    segment(record.projectId); segment(record.taskId);
    const normalized = { ...record, createdAt: timestamp(record.createdAt, "createdAt"), updatedAt: timestamp(record.updatedAt, "updatedAt") };
    return this.write(async () => {
      await this.ensureRoot();
      const taskPath = await this.safePath(join("Projects", segment(record.projectId), "Tasks", `${segment(record.taskId)}.md`));
      const previous = await this.readPathRecord(taskPath);
      await this.atomicWrite(taskPath, markdown(normalized, normalized.title));
      const previousState = previous && JSON.stringify(this.taskHistoryState(previous));
      const currentState = JSON.stringify(this.taskHistoryState(normalized));
      if (previousState !== currentState) {
        const event: ArchiveEvent = {
          eventId: `task-state-${fingerprint(currentState).slice(0, 32)}`,
          timestamp: normalized.updatedAt,
          type: "task_state_changed",
          projectId: normalized.projectId,
          taskId: normalized.taskId,
          employeeId: normalized.employeeId,
          runtimeId: normalized.runtimeId,
          modelId: normalized.modelId,
          payload: { status: normalized.status, title: normalized.title },
        };
        await this.writeEvent(event);
      }
      return record;
    });
  }

  async upsertEmployee(record: EmployeeRecord): Promise<EmployeeRecord> {
    return this.write(() => this.writeRecord(join("Employees", `${segment(record.employeeId)}.md`), record, record.name));
  }

  async recordDecision(record: DecisionRecord): Promise<DecisionRecord> {
    return this.write(() => this.writeRecord(join("Projects", segment(record.projectId), "Decisions", `${segment(record.decisionId)}.md`), record, record.title, record.body));
  }

  async recordReport(record: ReportRecord): Promise<ReportRecord> {
    return this.write(() => this.writeRecord(join("Projects", segment(record.projectId), "Reports", `${segment(record.reportId)}.md`), record, record.title, record.body));
  }

  async recordEvent(event: ArchiveEvent): Promise<{ recorded: boolean; path: string }> {
    segment(event.eventId); segment(event.type);
    const normalizedEvent = { ...event, timestamp: timestamp(event.timestamp, "event") };
    const date = normalizedEvent.timestamp.slice(0, 10);
    const relativePath = join("Events", date, `${segment(event.eventId)}.md`);
    return this.write(() => this.writeEvent(normalizedEvent, relativePath));
  }

  async appendEvent(event: ArchiveEvent): Promise<{ recorded: boolean; path: string }> {
    return this.recordEvent(event);
  }

  async recordArtifact(record: ArtifactRecord): Promise<ArtifactRecord> {
    return this.write(() => this.writeRecord(join("Projects", segment(record.projectId), "Artifacts", `${segment(record.artifactId)}.md`), record, record.artifactId, `Artifact path: ${safeValue(record.path)}`));
  }

  async getProject(projectId: string): Promise<ProjectRecord | undefined> { return this.readRecord(join("Projects", segment(projectId), "index.md")) as Promise<ProjectRecord | undefined>; }

  async getTaskHistory(projectId: string, taskId: string): Promise<ArchiveEvent[]> {
    return this.events(join("Events"), taskId, projectId);
  }

  async getProjectEvents(projectId: string): Promise<ArchiveEvent[]> {
    return this.events(join("Events"), undefined, projectId);
  }

  async getDecisions(projectId: string): Promise<DecisionRecord[]> { return this.readDirectory(join("Projects", segment(projectId), "Decisions")) as Promise<DecisionRecord[]>; }
  async getReports(projectId: string): Promise<ReportRecord[]> { return this.readDirectory(join("Projects", segment(projectId), "Reports")) as Promise<ReportRecord[]>; }
  async getArtifacts(projectId: string): Promise<ArtifactRecord[]> { return this.readDirectory(join("Projects", segment(projectId), "Artifacts")) as Promise<ArtifactRecord[]>; }

  async getRecent(limit = 20): Promise<Array<ProjectRecord | TaskRecord | EmployeeRecord | DecisionRecord | ReportRecord | ArchiveEvent>> {
    const files = await this.collectMarkdown(this.vaultRoot);
    const records = await Promise.all(files.map(async (path) => parseFrontmatter(await readFile(path, "utf8"))));
    return records
      .filter((record) => Object.keys(record).length > 0)
      .sort((a, b) => String(b.updatedAt ?? b.timestamp ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.timestamp ?? a.createdAt ?? "")))
      .slice(0, Math.max(0, limit)) as Array<ProjectRecord | TaskRecord | EmployeeRecord | DecisionRecord | ReportRecord | ArchiveEvent>;
  }

  async getRecoveryMetadata(limit = 20): Promise<ArchiveRecoveryMetadata> {
    await this.ensureRoot();
    const files = await this.collectMarkdown(this.vaultRoot);
    const projects: ProjectRecord[] = [];
    const incompleteTasks: TaskRecord[] = [];
    const recentEvents: ArchiveEvent[] = [];
    const readErrors: ArchiveReadError[] = [];
    const orphanedTempFiles: string[] = [];
    for (const path of await this.collectFiles(this.vaultRoot)) {
      if (path.endsWith(".tmp")) orphanedTempFiles.push(path);
    }
    for (const path of files) {
      try {
        const text = await readFile(path, "utf8");
        const record = parseFrontmatter(text, true);
        if (!text.startsWith(MANAGED)) continue;
        if (Object.keys(record).length === 0) throw new ArchiveValidationError("Malformed archive frontmatter");
        if (path.endsWith("/index.md") || path.endsWith(`${sep}index.md`)) projects.push(record as unknown as ProjectRecord);
        if (path.includes(`${sep}Tasks${sep}`) && record.taskId && !["completed", "succeeded", "failed", "cancelled"].includes(String(record.status))) incompleteTasks.push(record as unknown as TaskRecord);
        const event = eventFrom(text);
        if (event) recentEvents.push(event);
      } catch (error) {
        readErrors.push({ path, code: error instanceof ArchiveValidationError || error instanceof ArchiveCorruptionError ? "CORRUPT_MARKDOWN" : ((error as NodeJS.ErrnoException).code ?? "READ_ERROR"), message: error instanceof Error ? error.message : "Unable to read archive file" });
      }
    }
    const conflicts = await this.readConflicts();
    recentEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId));
    projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
    incompleteTasks.sort((a, b) => a.projectId.localeCompare(b.projectId) || a.taskId.localeCompare(b.taskId));
    return { projects, recentEvents: recentEvents.slice(-Math.max(0, limit)), incompleteTasks, conflicts, readErrors, orphanedTempFiles };
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation, operation);
    this.writeTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async writeRecord(relativePath: string, record: Record<string, unknown>, title: string, body = ""): Promise<any> {
    await this.ensureRoot();
    const path = await this.safePath(relativePath);
    await this.atomicWrite(path, markdown(record, title, body));
    return record;
  }

  private taskHistoryState(record: Record<string, unknown>): Record<string, unknown> {
    return { projectId: record.projectId, taskId: record.taskId, title: record.title, status: record.status, employeeId: record.employeeId, runtimeId: record.runtimeId, modelId: record.modelId, updatedAt: record.updatedAt };
  }

  private async writeEvent(event: ArchiveEvent, relativePath = join("Events", event.timestamp.slice(0, 10), `${segment(event.eventId)}.md`)): Promise<{ recorded: boolean; path: string }> {
    await this.ensureRoot();
    const path = await this.safePath(relativePath);
    if (await this.exists(path)) {
      const current = await this.readPathRecord(path);
      const incoming = { ...event, payload: persistedValue(event.payload ?? {}) };
      if (!current || fingerprint(current) !== fingerprint(incoming)) {
        await this.writeConflict(event.eventId, path, "eventId has different persisted data");
        throw new ArchiveEventConflictError(event.eventId, path);
      }
      return { recorded: false, path };
    }
    const record = { ...event, payload: persistedValue(event.payload ?? {}) };
    await this.atomicWrite(path, markdown(record, event.type, `Event ID: ${event.eventId}`));
    return { recorded: true, path };
  }

  private async readPathRecord(path: string): Promise<Record<string, unknown> | undefined> {
    try { return parseFrontmatter(await readFile(path, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }

  private async writeConflict(eventId: string, path: string, reason: string): Promise<void> {
    const conflict: ArchiveConflict = { conflictId: randomUUID(), eventId, path, detectedAt: this.clock().toISOString(), reason };
    await this.atomicWrite(await this.safePath(join("Recovery", "Conflicts", `${conflict.conflictId}.md`)), markdown(conflict as unknown as Record<string, unknown>, "Archive conflict", reason));
  }

  private async readConflicts(): Promise<ArchiveConflict[]> {
    const directory = await this.safeDirectory(join("Recovery", "Conflicts"));
    const result: ArchiveConflict[] = [];
    for (const path of await this.collectMarkdown(directory)) {
      try { const record = parseFrontmatter(await readFile(path, "utf8")); if (record.conflictId) result.push(record as unknown as ArchiveConflict); } catch { /* reported by readErrors for primary archive files */ }
    }
    return result.sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
  }

  private async ensureRoot(): Promise<void> {
    if (!this.rootReady) {
      this.rootReady = mkdir(this.vaultRoot, { recursive: true }).then(async () => {
        const info = await stat(this.vaultRoot);
        if (!info.isDirectory()) throw new Error("Archive vault root is not a directory");
        const actual = await realpath(this.vaultRoot);
        if (!contained(actual, actual)) throw new Error("Invalid archive vault root");
      });
    }
    return this.rootReady;
  }

  private async safePath(relativePath: string): Promise<string> {
    const path = resolve(this.vaultRoot, relativePath);
    const root = await realpath(this.vaultRoot);
    if (!contained(root, path)) throw new ArchivePathError(relativePath);
    await mkdir(dirname(path), { recursive: true });
    const parent = await realpath(dirname(path));
    if (!contained(root, parent)) throw new ArchivePathError(relativePath);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new ArchivePathError(relativePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return path;
  }

  private async safeDirectory(relativePath: string): Promise<string> {
    const path = resolve(this.vaultRoot, relativePath);
    const root = await realpath(this.vaultRoot);
    if (!contained(root, path)) throw new ArchivePathError(relativePath);
    await mkdir(path, { recursive: true });
    const actual = await realpath(path);
    if (!contained(root, actual)) throw new ArchivePathError(relativePath);
    return actual;
  }

  private async exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }

  private async atomicWrite(path: string, content: string): Promise<void> {
    if (await this.exists(path)) {
      const current = await readFile(path, "utf8");
      if (!current.startsWith(MANAGED)) throw new ArchiveConflictError(path);
      try { parseFrontmatter(current, true); } catch { throw new ArchiveCorruptionError(path); }
      if (current === content) return;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    try {
      await rename(temporary, path);
      const directory = await open(dirname(path), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      try { await unlink(temporary); } catch { /* preserve original error */ }
      throw error;
    }
  }

  private async readRecord(relativePath: string): Promise<Record<string, unknown> | undefined> {
    await this.ensureRoot();
    const path = await this.safePath(relativePath);
    try { return parseFrontmatter(await readFile(path, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }

  private async readDirectory(relativePath: string): Promise<Record<string, unknown>[]> {
    await this.ensureRoot();
    const directory = await this.safePath(join(relativePath, ".keep"));
    const entries = await readdir(dirname(directory), { withFileTypes: true });
    const records: Record<string, unknown>[] = [];
    for (const entry of entries) if (entry.isFile() && entry.name.endsWith(".md")) records.push(parseFrontmatter(await readFile(join(dirname(directory), entry.name), "utf8")));
    return records.filter((record) => Object.keys(record).length > 0);
  }

  private async events(relativePath: string, taskId?: string, projectId?: string): Promise<ArchiveEvent[]> {
    const files = await this.collectMarkdown(await this.safeDirectory(relativePath));
    const events: ArchiveEvent[] = [];
    for (const path of files) {
      const event = eventFrom(await readFile(path, "utf8"));
      if (event && (!taskId || event.taskId === taskId) && (!projectId || event.projectId === projectId)) events.push(event);
    }
    return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId));
  }

  private async collectMarkdown(root: string): Promise<string[]> {
    try { if ((await lstat(root)).isFile()) return root.endsWith(".md") ? [root] : []; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const results: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(root, entry.name);
      if (entry.isDirectory()) results.push(...await this.collectMarkdown(path));
      else if (entry.isFile() && entry.name.endsWith(".md")) results.push(path);
    }
    return results.sort();
  }

  private async collectFiles(root: string): Promise<string[]> {
    try { if ((await lstat(root)).isFile()) return [root]; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const results: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(root, entry.name);
      if (entry.isDirectory()) results.push(...await this.collectFiles(path));
      else if (entry.isFile()) results.push(path);
    }
    return results.sort();
  }
}

export function createArchive(options: ArchiveOptions): Archive { return new MarkdownArchive(options); }
