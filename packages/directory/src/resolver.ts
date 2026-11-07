import type { Department, Employee, Profession } from "@open-agent-office/shared";
import { DirectoryError } from "./errors.js";
import type { EmployeeMetadata, OrganizationDirectory } from "./registry.js";

export interface ResolvedEmployeeProfile { readonly employee: Employee; readonly profession: Profession; readonly department: Department; readonly specialization: string; readonly instructionRefs: readonly string[]; readonly skillReferences: readonly string[]; readonly availableSkillIds: readonly string[]; readonly unresolvedSkillIds: readonly string[]; }
export class EmployeeProfileResolver {
  constructor(private readonly directory: OrganizationDirectory, private readonly availableSkills: ReadonlySet<string> = new Set()) {}
  resolve(employeeId: string): ResolvedEmployeeProfile { const record = this.directory.employees.getRecord(employeeId); const profession = this.directory.professions.get(record.profile.professionId); const department = this.directory.departments.get(profession.departmentId); const refs = [...new Set([...profession.skillTags, ...record.profile.skillOverrides])]; return Object.freeze({ employee: record.profile, profession, department, specialization: record.metadata.specialization, instructionRefs: record.metadata.instructionRefs, skillReferences: refs, availableSkillIds: refs.filter(x=>this.availableSkills.has(x)), unresolvedSkillIds: refs.filter(x=>!this.availableSkills.has(x)) }); }
  resolveOrUndefined(employeeId: string): ResolvedEmployeeProfile | undefined { try { return this.resolve(employeeId); } catch (error) { if (error instanceof DirectoryError && error.code === "not_found") return undefined; throw error; } }
}
