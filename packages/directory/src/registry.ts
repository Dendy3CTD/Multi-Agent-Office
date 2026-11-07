import type { Department, Employee, Profession, Organization } from "@open-agent-office/shared";
import { DirectoryConflictError, DirectoryNotFoundError, DirectoryReferenceError } from "./errors.js";
import { validateDepartment, validateEmployee, validateProfession } from "./validation.js";

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) if (child && typeof child === "object" && !Object.isFrozen(child)) freeze(child); }
  return value;
};
const copy = <T>(value: T): T => freeze(structuredClone(value));

export interface EmployeeMetadata { readonly specialization: string; readonly instructionRefs: readonly string[]; readonly notes?: string; }
export interface EmployeeRecord { readonly profile: Employee; readonly metadata: EmployeeMetadata; }
export interface EmployeeFilter { readonly professionId?: string; readonly status?: string; }

export class DepartmentRegistry {
  protected readonly items = new Map<string, Department>();
  register(value: Department): void { validateDepartment(value); if (this.items.has(value.id)) throw new DirectoryConflictError("department", value.id); this.items.set(value.id, freeze(copy(value))); }
  get(id: string): Department { const item = this.items.get(id); if (!item) throw new DirectoryNotFoundError("department", id); return copy(item); }
  list(filter?: { status?: Department["status"] }): readonly Department[] { return [...this.items.values()].filter(x => !filter?.status || x.status === filter.status).sort((a,b)=>a.id.localeCompare(b.id)).map(copy); }
  has(id: string): boolean { return this.items.has(id); }
  update(id: string, patch: Partial<Department>): void {
    const current = this.get(id);
    const next = { ...current, ...patch, id };
    // Validate before mutating so a failed update leaves the registry untouched.
    validateDepartment(next);
    this.items.set(id, freeze(copy(next)));
  }
  disable(id: string): void { this.update(id, { status: "disabled" }); }
}

export class ProfessionRegistry {
  protected readonly items = new Map<string, Profession>();
  register(value: Profession): void {
    validateProfession(value);
    if (this.items.has(value.id)) throw new DirectoryConflictError("profession", value.id);
    this.items.set(value.id, freeze(copy(value)));
    try {
      this.assertNoCycle(value.id);
    } catch (error) {
      // A failed registration must not leave a poisoned profession behind.
      this.items.delete(value.id);
      throw error;
    }
  }
  private assertNoCycle(root: string): void {
    const seen = new Set<string>([root]);
    let cursor: Profession = this.items.get(root)!;
    while (cursor.extends !== undefined) {
      const parent = this.items.get(cursor.extends);
      if (!parent) throw new DirectoryReferenceError(`unknown profession parent: ${cursor.extends}`, cursor.extends);
      if (seen.has(parent.id)) throw new DirectoryReferenceError(`cyclic profession inheritance: ${root}`, root);
      seen.add(parent.id);
      cursor = parent;
    }
  }
  get(id: string): Profession { const item = this.items.get(id); if (!item) throw new DirectoryNotFoundError("profession", id); return copy(item); }
  list(filter?: { status?: Profession["status"]; departmentId?: string }): readonly Profession[] { return [...this.items.values()].filter(x => (!filter?.status || x.status === filter.status) && (!filter?.departmentId || x.departmentId === filter.departmentId)).sort((a,b)=>a.id.localeCompare(b.id)).map(copy); }
  has(id: string): boolean { return this.items.has(id); }
  update(id: string, patch: Partial<Profession>): void {
    const current = this.get(id);
    const next = { ...current, ...patch, id };
    validateProfession(next);
    const previous = this.items.get(id)!;
    this.items.set(id, freeze(copy(next)));
    try {
      this.assertNoCycle(id);
    } catch (error) {
      // A failed update must not leave either the patched or stale poisoned state.
      this.items.set(id, previous);
      throw error;
    }
  }
  disable(id: string): void { this.update(id, { status: "disabled" }); }
}

export class EmployeeRegistry {
  protected readonly items = new Map<string, EmployeeRecord>();
  initFromDefaults(defaults: Readonly<Record<string, string>>): void { for (const [id, modelDefault] of Object.entries(defaults)) this.register({ id, professionId: id, displayName: id, modelDefault, skillOverrides: [], status: "active" }); }
  register(profile: Employee, metadata: EmployeeMetadata = { specialization: profile.professionId, instructionRefs: [] }): void { validateEmployee(profile); if (this.items.has(profile.id)) throw new DirectoryConflictError("employee", profile.id); this.items.set(profile.id, freeze(copy({ profile, metadata }))); }
  get(id: string): Employee { return this.getRecord(id).profile; }
  getRecord(id: string): EmployeeRecord { const item = this.items.get(id); if (!item) throw new DirectoryNotFoundError("employee", id); return copy(item); }
  list(filter?: EmployeeFilter): readonly Employee[] { return [...this.items.values()].filter(x => (!filter?.professionId || x.profile.professionId === filter.professionId) && (!filter?.status || x.profile.status === filter.status)).sort((a,b)=>a.profile.id.localeCompare(b.profile.id)).map(x => copy(x.profile)); }
  records(): readonly EmployeeRecord[] { return [...this.items.values()].sort((a,b)=>a.profile.id.localeCompare(b.profile.id)).map(copy); }
  update(id: string, patch: Partial<Employee>, metadata?: Partial<EmployeeMetadata>): void { const current = this.getRecord(id); const next = { ...current.profile, ...patch, id }; validateEmployee(next); this.items.set(id, freeze(copy({ profile: next, metadata: { ...current.metadata, ...metadata } }))); }
  deactivate(id: string): void { this.update(id, { status: "disabled" }); }
  has(id: string): boolean { return this.items.has(id); }
}

export interface DirectorySnapshot { readonly organization: Organization; readonly departments: readonly Department[]; readonly professions: readonly Profession[]; readonly employees: readonly EmployeeRecord[]; }
export class OrganizationRegistry {
  private item?: Organization;
  register(value: Organization): void { if (!value.name.trim() || value.departmentIds.length === 0) throw new DirectoryReferenceError("organization requires a name and departments"); const ids = new Set(value.departmentIds); if (ids.size !== value.departmentIds.length) throw new DirectoryReferenceError("organization department ids must be unique"); this.item = freeze(copy(value)); }
  get(): Organization { if (!this.item) throw new DirectoryNotFoundError("organization", "default"); return copy(this.item); }
}

export class OrganizationDirectory {
  readonly organization = new OrganizationRegistry(); readonly departments = new DepartmentRegistry(); readonly professions = new ProfessionRegistry(); readonly employees = new EmployeeRegistry();
  registerDepartment(value: Department): void { this.departments.register(value); }
  registerProfession(value: Profession): void { if (!this.departments.has(value.departmentId)) throw new DirectoryReferenceError(`unknown department: ${value.departmentId}`, value.id); if (value.extends && !this.professions.has(value.extends)) throw new DirectoryReferenceError(`unknown parent profession: ${value.extends}`, value.id); this.professions.register(value); this.validateInheritance(); }
  registerEmployee(value: Employee, metadata?: EmployeeMetadata, options: { readonly allowDisabledProfession?: boolean } = {}): void {
    if (!this.professions.has(value.professionId)) throw new DirectoryReferenceError(`unknown profession: ${value.professionId}`, value.id);
    // A disabled profession must not gain new assignments without an explicit policy in place;
    // snapshot restoration is not a new assignment and is permitted with `allowDisabledProfession`.
    if (!options.allowDisabledProfession && this.professions.get(value.professionId).status === "disabled") throw new DirectoryReferenceError(`profession is disabled: ${value.professionId}`, value.id);
    this.employees.register(value, metadata);
  }
  removeDepartment(id: string): void { if (this.professions.list({ departmentId: id }).length) throw new DirectoryReferenceError(`department is referenced by professions: ${id}`, id); throw new DirectoryReferenceError(`hard deletion is not supported; disable department instead: ${id}`, id); }
  removeProfession(id: string): void { if (this.employees.list({ professionId: id }).length) throw new DirectoryReferenceError(`profession is referenced by employees: ${id}`, id); throw new DirectoryReferenceError(`hard deletion is not supported; disable profession instead: ${id}`, id); }
  employeesByDepartment(departmentId: string): readonly Employee[] { if (!this.departments.has(departmentId)) throw new DirectoryNotFoundError("department", departmentId); return this.employees.list().filter(e => this.professions.get(e.professionId).departmentId === departmentId); }
  employeesByCapability(capability: string): readonly Employee[] { return this.employees.list().filter(e => this.professions.get(e.professionId).capabilityRequirements.includes(capability)); }
  validateIntegrity(): void { const org = this.organization.get(); for (const id of org.departmentIds) if (!this.departments.has(id)) throw new DirectoryReferenceError(`organization references unknown department: ${id}`); for (const p of this.professions.list()) { if (!this.departments.has(p.departmentId)) throw new DirectoryReferenceError(`profession references unknown department: ${p.id}`); if (p.extends && !this.professions.has(p.extends)) throw new DirectoryReferenceError(`profession references unknown parent: ${p.id}`); } for (const e of this.employees.list()) if (!this.professions.has(e.professionId)) throw new DirectoryReferenceError(`employee references unknown profession: ${e.id}`); this.validateInheritance(); }
  private validateInheritance(): void { for (const p of this.professions.list()) { const seen = new Set<string>(); let cursor: Profession | undefined = p; while (cursor?.extends) { if (seen.has(cursor.id)) throw new DirectoryReferenceError(`cyclic profession inheritance: ${p.id}`); seen.add(cursor.id); cursor = this.professions.get(cursor.extends); } } }
  snapshot(): DirectorySnapshot { return freeze(copy({ organization: this.organization.get(), departments: this.departments.list(), professions: this.professions.list(), employees: this.employees.records() })); }
  static fromSnapshot(snapshot: DirectorySnapshot): OrganizationDirectory { const d = new OrganizationDirectory(); for (const x of snapshot.departments) d.registerDepartment(x); for (const x of snapshot.professions) d.registerProfession(x); for (const x of snapshot.employees) d.registerEmployee(x.profile, x.metadata, { allowDisabledProfession: true }); d.organization.register(snapshot.organization); d.validateIntegrity(); return d; }
}
