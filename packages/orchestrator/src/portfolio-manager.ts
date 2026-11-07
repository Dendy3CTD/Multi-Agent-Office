import type { Project, ProjectPriority, ProjectPriorityPolicy } from "@open-agent-office/shared";

export type PortfolioStatus = "active" | "paused" | "quotaExhausted";
export interface ProjectRegistration extends Project {}
export interface PortfolioEntry { readonly project: Project; readonly status: PortfolioStatus; readonly activeTaskCount: number; }
export interface PortfolioDecision { readonly admitted: readonly PortfolioEntry[]; readonly rejected: readonly PortfolioEntry[]; }
export interface PortfolioEvent { readonly type: "registered" | "policy_changed" | "status_changed"; readonly projectId: string; }

const priorityRank: Record<ProjectPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const immutable = <T>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) if (child && typeof child === "object" && !Object.isFrozen(child)) immutable(child); } return value; };
const clone = <T>(value: T): T => immutable(structuredClone(value));

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Float-safe comparison for RUB-free shares: 0.2×5 sums to 1.0000000000000002. */
const BUDGET_SHARE_TOLERANCE = 1e-9;

function validateProject(project: Project): void {
  if (!ID_PATTERN.test(project.id)) throw new TypeError("project.id is invalid");
  if (!project.name.trim() || !project.rootDir.startsWith("/")) throw new TypeError("project name and absolute rootDir are required");
  const p = project.portfolio;
  if (!Number.isFinite(p.budgetShare) || p.budgetShare < 0 || p.budgetShare > 1) throw new TypeError("budgetShare must be between 0 and 1");
  if (!Number.isSafeInteger(p.maxConcurrentExecutions) || p.maxConcurrentExecutions < 1) throw new TypeError("maxConcurrentExecutions must be positive");
  if (!["active", "paused", "archived"].includes(project.status)) throw new TypeError("invalid project status");
}

export class ProjectPortfolio {
  private readonly projects = new Map<string, Project>();
  private readonly activeTasks = new Map<string, Set<string>>();
  private readonly listeners = new Set<(event: PortfolioEvent) => void>();

  register(project: ProjectRegistration): void { validateProject(project); if (this.projects.has(project.id)) throw new Error(`project already exists: ${project.id}`); if (this.activeBudgetShare(project) > 1 + BUDGET_SHARE_TOLERANCE) throw new Error("active project budgetShare total must not exceed 1"); this.projects.set(project.id, clone(project)); this.activeTasks.set(project.id, new Set()); this.emit({ type: "registered", projectId: project.id }); }
  get(projectId: string): Project { const project = this.projects.get(projectId); if (!project) throw new Error(`project not found: ${projectId}`); return clone(project); }
  list(): readonly PortfolioEntry[] { return [...this.projects.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(project => ({ project: clone(project), status: this.statusOf(project), activeTaskCount: this.activeTasks.get(project.id)?.size ?? 0 })); }
  setPolicy(projectId: string, policy: ProjectPriorityPolicy): void { const project = this.get(projectId); validateProject({ ...project, portfolio: policy }); if (this.activeBudgetShare({ ...project, portfolio: policy }) > 1 + BUDGET_SHARE_TOLERANCE) throw new Error("active project budgetShare total must not exceed 1"); this.projects.set(projectId, clone({ ...project, portfolio: policy })); this.emit({ type: "policy_changed", projectId }); }
  setStatus(projectId: string, status: Project["status"]): void { if (!["active", "paused", "archived"].includes(status)) throw new TypeError("invalid project status"); const project = this.get(projectId); this.projects.set(projectId, clone({ ...project, status })); this.emit({ type: "status_changed", projectId }); }
  admission(): PortfolioDecision { const entries = this.list().filter(x => x.project.status !== "archived"); const active = entries.filter(x => x.status === "active").sort((a,b) => priorityRank[a.project.portfolio.priority] - priorityRank[b.project.portfolio.priority] || a.project.id.localeCompare(b.project.id)); return { admitted: active, rejected: entries.filter(x => !active.includes(x)) }; }
  reserve(projectId: string, taskId: string): boolean { const project = this.get(projectId); const tasks = this.activeTasks.get(projectId)!; if (this.statusOf(project) !== "active" || tasks.size >= project.portfolio.maxConcurrentExecutions || tasks.has(taskId)) return false; tasks.add(taskId); return true; }
  release(projectId: string, taskId: string): void { this.activeTasks.get(projectId)?.delete(taskId); }
  onPolicyChange(listener: (event: PortfolioEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  snapshot(): readonly PortfolioEntry[] { return this.list(); }
  private statusOf(project: Project): PortfolioStatus { if (project.status === "paused") return "paused"; if (project.status === "archived") return "quotaExhausted"; const tasks = this.activeTasks.get(project.id)?.size ?? 0; return tasks >= project.portfolio.maxConcurrentExecutions ? "quotaExhausted" : "active"; }
  private activeBudgetShare(replacement: Project): number { return [...this.projects.values()].filter(x => x.status === "active" && x.id !== replacement.id).reduce((sum, x) => sum + x.portfolio.budgetShare, 0) + (replacement.status === "active" ? replacement.portfolio.budgetShare : 0); }
  totalActiveBudgetShare(): number { return [...this.projects.values()].filter(x => x.status === "active").reduce((sum, x) => sum + x.portfolio.budgetShare, 0); }
  private emit(event: PortfolioEvent): void { for (const listener of this.listeners) listener(event); }
}
