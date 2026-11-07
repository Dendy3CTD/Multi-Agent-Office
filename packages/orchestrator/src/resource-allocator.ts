import type { ProjectPriority, RuntimeDescriptor } from "@open-agent-office/shared";
import { ProjectPortfolio } from "./portfolio-manager.js";

export interface DirectoryEmployeeSnapshot { readonly id: string; readonly departmentId: string; readonly professionId: string; readonly status: "active" | "disabled"; readonly availableSkillIds: readonly string[]; readonly unresolvedSkillIds?: readonly string[]; readonly capabilityRequirements?: readonly string[]; }
export type SchedulingPriority = ProjectPriority | "interactive" | "normal";
export interface ResourceRequest { readonly taskId: string; readonly projectId: string; readonly priority: SchedulingPriority; readonly employeeId?: string; readonly departmentId?: string; readonly professionId?: string; readonly requiredCapabilities?: readonly string[]; readonly requiredSkills?: readonly string[]; readonly runtimeId?: string; readonly modelId?: string; }
export interface ResourceAssignment { readonly taskId: string; readonly projectId: string; readonly employeeId: string; readonly reason: string; }
export interface CategoryAvailability { readonly money?: boolean; readonly subscription?: boolean; readonly free?: boolean; readonly local?: boolean; }
export interface SlotComputationInput { readonly requestedTarget?: number; readonly runtimeConcurrency?: number | null; readonly categoryAvailability?: CategoryAvailability; readonly budgetStatus?: "normal" | "warning" | "critical" | "blocked" | "unknown"; readonly activeEmployeeCount?: number; }
export interface ResourceDecision { readonly timestamp: string; readonly slots: number; readonly baseline: 2; readonly maximum: 20; readonly perProject: Readonly<Record<string, number>>; readonly reason: string; }
export interface SlotPolicyPort { updateTargetSlots(target: number): void; }

const priorityRank: Record<ProjectPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const now = () => new Date().toISOString();
const immutable = <T>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) if (child && typeof child === "object" && !Object.isFrozen(child)) immutable(child); } return value; };
const deepCopy = <T>(value: T): T => immutable(structuredClone(value));

/**
 * Category-driven capacity (ADR-MAO-014): only categories explicitly present
 * and false block capacity; unknown quotas (absent or empty availability) are
 * permissive and never silently zero out work capacity.
 */
function categoryCapacity(availability: CategoryAvailability | undefined): boolean {
  if (availability === undefined) return true;
  const values = Object.values(availability);
  if (values.length === 0) return true;
  return values.some(value => value === true);
}

export class ResourceAllocator {
  private readonly assignments = new Map<string, ResourceAssignment>();
  private readonly employeeTasks = new Map<string, string>();
  private readonly decisions: ResourceDecision[] = [];
  constructor(private readonly employees: readonly DirectoryEmployeeSnapshot[], private readonly portfolio: ProjectPortfolio, private readonly runtimes: readonly RuntimeDescriptor[] = []) {}

  allocate(request: ResourceRequest): ResourceAssignment | undefined {
    if (!ID_PATTERN.test(request.taskId) || !ID_PATTERN.test(request.projectId)) return undefined;
    if (!this.portfolio.get(request.projectId) || this.assignments.has(request.taskId)) return undefined;
    const project = this.portfolio.get(request.projectId);
    // Direct allocations respect portfolio status just like scheduled dispatch.
    if (project.status !== "active") return undefined;
    const candidates = this.employees.filter(employee => employee.status === "active" && !this.employeeTasks.has(employee.id) && (!request.employeeId || request.employeeId === employee.id) && (!request.departmentId || employee.departmentId === request.departmentId) && (!request.professionId || employee.professionId === request.professionId) && this.matches(employee, request));
    const ranked = candidates.sort((a,b) => this.score(b, request) - this.score(a, request) || a.id.localeCompare(b.id));
    const employee = ranked[0]; if (!employee) return undefined;
    if (!request.runtimeId || this.runtimeAvailable(request.runtimeId, request.modelId)) { const assignment = Object.freeze({ taskId: request.taskId, projectId: request.projectId, employeeId: employee.id, reason: "deterministic capability and availability match" }); this.assignments.set(request.taskId, assignment); this.employeeTasks.set(employee.id, request.taskId); return assignment; }
    return undefined;
  }
  release(taskId: string): void { const assignment = this.assignments.get(taskId); if (!assignment) return; this.assignments.delete(taskId); this.employeeTasks.delete(assignment.employeeId); }
  isBusy(employeeId: string): boolean { return this.employeeTasks.has(employeeId); }
  activeAssignments(): readonly ResourceAssignment[] { return [...this.assignments.values()].sort((a,b)=>a.taskId.localeCompare(b.taskId)); }
  computeTargetSlots(input: SlotComputationInput = {}): ResourceDecision { const requested = input.requestedTarget ?? 2; if (!Number.isInteger(requested) || requested < 0) throw new TypeError("requestedTarget must be a non-negative integer"); if (input.runtimeConcurrency !== null && input.runtimeConcurrency !== undefined && (!Number.isInteger(input.runtimeConcurrency) || input.runtimeConcurrency < 0)) throw new TypeError("runtimeConcurrency must be null or a non-negative integer"); if (input.activeEmployeeCount !== undefined && (!Number.isInteger(input.activeEmployeeCount) || input.activeEmployeeCount < 0)) throw new TypeError("activeEmployeeCount must be a non-negative integer"); const runtime = input.runtimeConcurrency ?? Infinity; const employees = input.activeEmployeeCount ?? this.employees.filter(e=>e.status === "active").length; const availability = input.categoryAvailability; const categoryKnown = availability !== undefined; const anyCategory = categoryCapacity(availability); const budgetBlocked = input.budgetStatus === "blocked"; const slots = budgetBlocked || !anyCategory ? 0 : Math.min(20, requested, runtime, employees); const perProject: Record<string, number> = {}; for (const entry of this.portfolio.admission().admitted) perProject[entry.project.id] = Math.min(slots, entry.project.portfolio.maxConcurrentExecutions); const decision = Object.freeze({ timestamp: now(), slots, baseline: 2 as const, maximum: 20 as const, perProject, reason: budgetBlocked ? "budget policy is blocked" : !anyCategory ? "all declared budget categories are blocked" : slots < requested ? "capped by runtime, employees, or policy" : "within dynamic capacity" }); this.decisions.push(decision); return decision; }
  applyToPolicy(policy: SlotPolicyPort, decision = this.decisions.at(-1)): void { if (!decision) throw new Error("computeTargetSlots must run before applyToPolicy"); policy.updateTargetSlots(decision.slots); }
  history(): readonly ResourceDecision[] { return this.decisions.map(x => deepCopy(x)); }
  private matches(employee: DirectoryEmployeeSnapshot, request: ResourceRequest): boolean { const skills = employee.availableSkillIds ?? []; if ((request.requiredSkills ?? []).some(skill => !skills.includes(skill))) return false; const capabilities = employee.capabilityRequirements ?? []; return (request.requiredCapabilities ?? []).every(cap => capabilities.includes(cap)); }
  private score(employee: DirectoryEmployeeSnapshot, request: ResourceRequest): number { let score = 0; if (request.employeeId === employee.id) score += 1000; if (request.professionId === employee.professionId) score += 100; if (request.departmentId === employee.departmentId) score += 50; score += (request.requiredSkills ?? []).filter(x=>(employee.availableSkillIds ?? []).includes(x)).length * 10; return score + (request.priority === "interactive" ? 1 : 0); }
  private runtimeAvailable(runtimeId: string, modelId?: string): boolean {
    const runtime = this.runtimes.find(x=>x.id === runtimeId);
    if (!runtime || runtime.status !== "available") return false;
    if (modelId) {
      const provider = modelId.split("/", 1)[0];
      // Provider pinning (ADR-MAO-011): a runtime accepts a model only when its
      // provider pool is declared; prefix coverage alone is not sufficient.
      if (runtime.capabilities.supportedProviders.length > 0 && !runtime.capabilities.supportedProviders.includes(provider as never)) return false;
      if (runtime.capabilities.supportedModels === "*") return true;
      return runtime.capabilities.supportedModels.some(prefix => modelId === prefix || modelId.startsWith(`${prefix}/`));
    }
    return true;
  }
}

export { deepCopy, immutable };
