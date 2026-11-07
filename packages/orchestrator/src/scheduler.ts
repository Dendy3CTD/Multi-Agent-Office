import { ProjectPortfolio } from "./portfolio-manager.js";
import { ResourceAllocator, type ResourceAssignment, type ResourceRequest, type SchedulingPriority } from "./resource-allocator.js";

export interface ScheduledTask extends ResourceRequest { readonly sequence: number; readonly queuedAt: string; }
export interface ScheduleResult { readonly assigned: readonly ResourceAssignment[]; readonly pending: readonly ScheduledTask[]; }
const rank: Record<SchedulingPriority, number> = { interactive: 0, critical: 1, high: 2, normal: 3, low: 4 };
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const immutable = <T>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) if (child && typeof child === "object" && !Object.isFrozen(child)) immutable(child); } return value; };

export class TaskScheduler {
  private readonly queue: ScheduledTask[] = []; private sequence = 0;
  constructor(private readonly portfolio: ProjectPortfolio, private readonly allocator: ResourceAllocator) {}
  enqueue(request: ResourceRequest): ScheduledTask {
    if (!ID_PATTERN.test(request.taskId)) throw new TypeError("task id is invalid");
    if (!ID_PATTERN.test(request.projectId)) throw new TypeError("project id is invalid");
    if (!(request.priority in rank)) throw new TypeError(`priority must be one of: ${Object.keys(rank).join(", ")}`);
    const project = this.portfolio.get(request.projectId);
    // Archived projects are closed for work; paused projects may queue for later resume.
    if (project.status === "archived") throw new TypeError(`project is archived: ${request.projectId}`);
    if (this.queue.some(x=>x.taskId===request.taskId) || this.allocator.activeAssignments().some(x=>x.taskId===request.taskId)) throw new Error(`task already scheduled: ${request.taskId}`);
    // The queued item must not share mutable arrays with the caller's input.
    const item = immutable(structuredClone({ ...request, sequence: ++this.sequence, queuedAt: new Date().toISOString() }));
    this.queue.push(item);
    return item;
  }
  cancel(taskId: string): boolean { const index = this.queue.findIndex(x=>x.taskId===taskId); if (index < 0) return false; this.queue.splice(index, 1); return true; }
  schedule(slots: number): ScheduleResult { if (!Number.isSafeInteger(slots) || slots < 0) throw new TypeError("slots must be a non-negative integer"); const assigned: ResourceAssignment[] = []; const ordered = [...this.queue].sort((a,b)=>rank[a.priority]-rank[b.priority] || this.projectRank(a.projectId)-this.projectRank(b.projectId) || a.sequence-b.sequence); for (const task of ordered) { if (assigned.length >= slots) break; if (!this.portfolio.reserve(task.projectId, task.taskId)) continue; const assignment = this.allocator.allocate(task); if (!assignment) { this.portfolio.release(task.projectId, task.taskId); continue; } assigned.push(assignment); this.queue.splice(this.queue.findIndex(x=>x.taskId===task.taskId), 1); } return { assigned, pending: [...this.queue].sort((a,b)=>a.sequence-b.sequence) }; }
  complete(taskId: string, outcome: "completed" | "failed" | "cancelled" = "completed"): void { const assignment = this.allocator.activeAssignments().find(x=>x.taskId===taskId); if (!assignment) return; this.allocator.release(taskId); this.portfolio.release(assignment.projectId, taskId); void outcome; }
  pending(): readonly ScheduledTask[] { return [...this.queue].sort((a,b)=>a.sequence-b.sequence); }
  private projectRank(projectId: string): number { const priority = this.portfolio.get(projectId).portfolio.priority; return priority === "critical" ? 0 : priority === "high" ? 1 : priority === "normal" ? 2 : 3; }
}
