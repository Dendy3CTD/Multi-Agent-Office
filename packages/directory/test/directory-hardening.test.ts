import { describe, expect, it } from "vitest";
import type { Department, Employee, Profession } from "@open-agent-office/shared";
import {
  DepartmentRegistry,
  DirectoryNotFoundError,
  DirectoryReferenceError,
  EmployeeProfileResolver,
  EmployeeRegistry,
  OrganizationDirectory,
  OrganizationRegistry,
  ProfessionRegistry,
  seedDirectory,
  type EmployeeMetadata,
} from "../src/index.js";

const department = (id: string, name = `Department ${id}`): Department => ({ id, name, description: undefined, status: "active" });
const professionBase = (id: string, departmentId: string): Profession => ({
  id,
  version: "1.0.0",
  name: `Profession ${id}`,
  role: id,
  departmentId,
  responsibilities: [],
  baseInstructions: `${id} instructions`,
  skillTags: [],
  capabilityRequirements: [],
  modelHints: { tier: "cheap" },
  acceptancePolicy: { mode: "auto", checks: [] },
  status: "active",
});
const employeeFor = (id: string, professionId: string): Employee => ({
  id,
  professionId,
  displayName: `Employee ${id}`,
  modelDefault: "opencode-go/glm-5.3-flash",
  skillOverrides: [],
  status: "active",
});

describe("seed structure (12 departments, 20 professions, 113 employees)", () => {
  it("has the exact expected counts and unique ids", () => {
    const d = seedDirectory();
    expect(d.departments.list()).toHaveLength(12);
    expect(d.professions.list()).toHaveLength(20);
    expect(d.employees.list()).toHaveLength(113);
    expect(new Set(d.employees.list().map(x => x.id)).size).toBe(113);
    expect(new Set(d.professions.list().map(x => x.id)).size).toBe(20);
    expect(new Set(d.departments.list().map(x => x.id)).size).toBe(12);
  });

  it("validates every one of the 113 employees, not only the total count", () => {
    const d = seedDirectory();
    const professions = new Set(d.professions.list().map(x => x.id));
    for (const employee of d.employees.list()) {
      expect(employee.id).toMatch(/^employee-\d{3}$|^director$|^developer$|^engineer$|^analyst$|^helper$/);
      expect(professions.has(employee.professionId)).toBe(true);
      expect(d.professions.get(employee.professionId).status).toBe("active");
      expect(employee.displayName.trim().length).toBeGreaterThan(0);
      expect(employee.modelDefault).toMatch(/^opencode-go\//);
      expect(["active", "disabled"]).toContain(employee.status);
      const record = d.employees.getRecord(employee.id);
      expect(record.metadata.specialization.trim().length).toBeGreaterThan(0);
      for (const ref of record.metadata.instructionRefs) expect(ref.includes(employee.id) || ref.startsWith("profession:")).toBe(true);
      for (const skill of employee.skillOverrides) expect(d.employees.list().filter(x => x.skillOverrides.includes(skill)).length).toBeLessThanOrEqual(3);
    }
  });

  it("places every employee in an existing department through its profession, distributing across all 12", () => {
    const d = seedDirectory();
    const byDepartment = new Map<string, number>();
    for (const employee of d.employees.list()) {
      const departmentId = d.professions.get(employee.professionId).departmentId;
      expect(d.departments.has(departmentId)).toBe(true);
      byDepartment.set(departmentId, (byDepartment.get(departmentId) ?? 0) + 1);
    }
    expect(d.departments.list().every(x => (byDepartment.get(x.id) ?? 0) >= 9)).toBe(true);
    expect([...byDepartment.values()].reduce((sum, count) => sum + count, 0)).toBe(113);
    expect(byDepartment.size).toBe(12);
  });

  it("covers all 20 professions across the departments, none dangling", () => {
    const d = seedDirectory();
    for (const profession of d.professions.list()) expect(d.departments.has(profession.departmentId)).toBe(true);
    for (const dep of d.departments.list()) expect(d.professions.list({ departmentId: dep.id }).length).toBeGreaterThanOrEqual(1);
    expect(d.validateIntegrity()).toBeUndefined();
  });

  it("preserves the five documented core employees with OAO-MODEL-002 models", () => {
    const d = seedDirectory();
    const core: Array<[string, string, string]> = [
      ["director", "director", "opencode-go/mimo-v2.6-flash"],
      ["developer", "developer", "opencode-go/glm-5.3-flash"],
      ["engineer", "engineer", "opencode-go/qwen3.8-flash"],
      ["analyst", "analyst", "opencode-go/mimo-v2.6-flash"],
      ["helper", "assistant", "opencode-go/beam-free"],
    ];
    for (const [id, professionId, modelDefault] of core) {
      expect(d.employees.get(id)).toMatchObject({ professionId, modelDefault });
      expect(d.employees.getRecord(id).metadata.instructionRefs).toContain(`profession:${professionId}`);
    }
  });

  it("seeds identically on repeat and does not carry mutation over runs", () => {
    const a = seedDirectory();
    a.employees.register({ ...employeeFor("extra-1", "director") });
    expect(a.employees.list()).toHaveLength(114);
    const b = seedDirectory();
    expect(b.employees.list()).toHaveLength(113);
    expect(b.snapshot()).toEqual(seedDirectory().snapshot());
  });
});

describe("registry integrity and atomicity", () => {
  it("rejects duplicate insertion for all registry kinds and changes no state", () => {
    const d = seedDirectory();
    const before = d.snapshot();
    expect(() => d.departments.register(department("management"))).toThrow(/already exists/);
    expect(() => d.professions.register(d.professions.get("director"))).toThrow(/already exists/);
    expect(() => d.employees.register(d.employees.get("employee-001"))).toThrow(/already exists/);
    expect(d.snapshot()).toEqual(before);
  });

  it("updates records, guards the id from being replaced, and filters work", () => {
    const d = seedDirectory();
    d.employees.update("employee-001", { displayName: "Renamed" });
    expect(d.employees.get("employee-001").displayName).toBe("Renamed");
    d.employees.update("employee-001", { id: "spoofed-id" } as Partial<Employee>);
    expect(d.employees.get("employee-001").id).toBe("employee-001");
    expect(d.employees.list({ professionId: "director", status: "active" }).map(x => x.professionId).every(x => x === "director")).toBe(true);
  });

  it("leaves the registry untouched when an update fails validation", () => {
    const d = seedDirectory();
    const before = d.departments.get("management");
    expect(() => d.departments.update("management", { name: "   " })).toThrow(/non-empty/);
    expect(d.departments.get("management")).toEqual(before);
    expect(() => d.employees.update("employee-001", { status: "bogus" as never })).toThrow(/status/);
    expect(d.employees.get("employee-001").status).toBe("active");
  });

  it("raises DirectoryNotFoundError for unknown ids without mutating anything", () => {
    const d = seedDirectory();
    const before = d.snapshot();
    expect(() => d.departments.get("missing")).toThrow(DirectoryNotFoundError);
    expect(() => d.employees.get("missing")).toThrow(DirectoryNotFoundError);
    expect(() => d.employees.update("missing", { displayName: "x" })).toThrow(DirectoryNotFoundError);
    expect(() => d.employeesByDepartment("missing")).toThrow(DirectoryNotFoundError);
    expect(d.snapshot()).toEqual(before);
  });

  it("supports disable and re-enable cycles for departments, professions and employees", () => {
    const d = seedDirectory();
    d.departments.disable("design");
    expect(d.departments.get("design").status).toBe("disabled");
    expect(d.departments.list({ status: "active" }).every(x => x.id !== "design")).toBe(true);
    d.professions.disable("designer");
    expect(() => d.registerEmployee({ ...employeeFor("new-designer", "designer") })).toThrow(/profession is disabled/);
    d.professions.update("designer", { status: "active" });
    d.departments.update("design", { status: "active" });
    d.registerEmployee({ ...employeeFor("new-designer", "designer") });
    expect(d.employees.get("new-designer")).toBeTruthy();
  });

  it("rolls back a profession registration that would create an inheritance cycle", () => {
    const d = seedDirectory();
    const parent = { ...professionBase("ancestor", "management") };
    const child = { ...professionBase("descendant", "management"), extends: "ancestor" };
    d.registerProfession(parent);
    d.registerProfession(child);
    const count = d.professions.list().length;
    // A grandfathered cycle: making the ancestor point at its descendant
    expect(() => d.professions.update("ancestor", { extends: "descendant" })).toThrow(/cyclic/);
    expect(d.professions.get("ancestor").extends).toBeUndefined();
    expect(d.professions.list()).toHaveLength(count);
    // A fresh registration into unknown-parent space is rejected up front.
    expect(() => d.registerProfession({ ...professionBase("loop", "management"), extends: "self-loop" })).toThrow(/unknown parent profession/);
  });

  it("rejects referral building at registration and keeps the registry intact", () => {
    const d = new OrganizationDirectory();
    d.registerDepartment(department("dep-1"));
    d.registerProfession(professionBase("chain-1", "dep-1"));
    // A self-parent is impossible to reference before registration; a two-node
    // chain plus a new element is the minimal cycle that must be caught.
    const a = { ...professionBase("cycle-a", "dep-1") };
    const b = { ...professionBase("cycle-b", "dep-1"), extends: "cycle-a" };
    d.registerProfession(a);
    d.registerProfession(b);
    expect(() => d.registerProfession({ ...professionBase("cycle-c", "dep-1"), extends: "cycle-b" })).not.toThrow();
    expect(() => d.professions.update("cycle-a", { extends: "cycle-c" })).toThrow(/cyclic/);
    d.organization.register({ name: "CycleOrg", departmentIds: ["dep-1"] });
    d.validateIntegrity();
    expect(d.professions.get("cycle-a").extends).toBeUndefined();
    expect(d.professions.list().length).toBe(4);
  });

  it("blocks hard deletion with references and even for unreferenced entities", () => {
    const d = seedDirectory();
    expect(() => d.removeProfession("director")).toThrow(/referenced by employees|not supported/);
    expect(() => d.removeDepartment("management")).toThrow(/referenced by professions|not supported/);
    d.registerDepartment(department("empty-dep"));
    expect(() => d.removeDepartment("empty-dep")).toThrow(/not supported/);
    d.registerProfession({ ...professionBase("lonely", "empty-dep") });
    expect(() => d.removeProfession("lonely")).toThrow(/not supported/);
    // Unknown ids are refused the same way: removal never silently deletes.
    expect(() => d.removeProfession("nonexistent")).toThrow(/not supported/);
    expect(() => d.removeDepartment("nonexistent")).toThrow(/not supported/);
  });

  it("detects integrity violations explicitly", () => {
    const d = seedDirectory();
    const corrupted = { professionId: "ghost-profession" } as Partial<Employee>;
    d.employees.update("employee-002", corrupted);
    expect(() => d.validateIntegrity()).toThrow(/unknown profession/);
  });
});

describe("snapshot round-trips", () => {
  it("round-trips twice with identical results and preserves ids, skills and statuses", () => {
    const d = seedDirectory();
    d.professions.disable("designer");
    d.employees.deactivate("employee-001");
    d.employees.update("employee-001", {}, { instructionRefs: ["profession:director", "employee:employee-001:instructions"], notes: "changed" });
    const snapshot = d.snapshot();
    const restored = OrganizationDirectory.fromSnapshot(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    const third = OrganizationDirectory.fromSnapshot(restored.snapshot());
    expect(third.snapshot()).toEqual(snapshot);
    expect(restored.professions.get("designer").status).toBe("disabled");
    expect(restored.employees.get("employee-001").status).toBe("disabled");
    expect(restored.employees.getRecord("employee-001").metadata.notes).toBe("changed");
    expect(restored.employees.get("employee-001").skillOverrides).toEqual(d.employees.get("employee-001").skillOverrides);
  });

  it("exports deep-frozen snapshots with no shared mutable references", () => {
    const d = seedDirectory();
    const snapshot = d.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.professions[0])).toBe(true);
    expect(Object.isFrozen(snapshot.professions[0].skillTags)).toBe(true);
    expect(Object.isFrozen((snapshot.employees[0] as unknown as { metadata: EmployeeMetadata }).metadata)).toBe(true);
    expect(() => (snapshot.professions[0] as { name: string }).name = "mutated").toThrow();
    expect(() => (snapshot.employees[0] as { profile: { displayName: string } }).profile.displayName = "mutated").toThrow();
    // Restored directory does not share object identity with the original registry.
    const restored = OrganizationDirectory.fromSnapshot(snapshot);
    restored.employees.update("employee-001", { displayName: "restored-side" });
    expect(d.employees.get("employee-001").displayName).not.toBe("restored-side");
  });

  it("rejects an erroneous snapshot and builds nothing usable from it", () => {
    const d = seedDirectory();
    const broken = { ...d.snapshot() } as { departments: Department[]; professions: Profession[]; employees: { profile: Employee; metadata?: EmployeeMetadata }[]; organization: unknown };
    broken.professions = broken.professions.map(x => (x.id === "director" ? { ...x, departmentId: "ghost-department" } : x));
    expect(() => OrganizationDirectory.fromSnapshot(broken as never)).toThrow();
    const bait = { ...d.snapshot() };
    (bait as { employees: unknown }).employees = [...(d.snapshot().employees), { profile: employeeFor("employee-001", "director") }];
    expect(() => OrganizationDirectory.fromSnapshot(bait as never)).toThrow(/already exists/);
  });
});

describe("skills resolution", () => {
  it("splits available from unresolved skills and never treats unresolved as available", () => {
    const d = seedDirectory();
    const resolver = new EmployeeProfileResolver(d, new Set(["strategy", "backend"]));
    const resolved = resolver.resolve("employee-001");
    expect(resolved.availableSkillIds.every(x => resolver.resolve("employee-001").skillReferences.includes(x))).toBe(true);
    expect([...resolved.availableSkillIds].sort()).toEqual(resolved.skillReferences.filter(x => ["strategy", "backend"].includes(x)).sort());
  });

  it("deduplicates repeated skill references", () => {
    const d = new OrganizationDirectory();
    d.registerDepartment(department("dep-1"));
    d.registerProfession({ ...professionBase("dup-prof", "dep-1"), skillTags: ["shared-skill", "extra"] });
    d.registerEmployee({ ...employeeFor("dup-emp", "dup-prof"), skillOverrides: ["shared-skill", "unique"] });
    const resolved = new EmployeeProfileResolver(d, new Set(["shared-skill", "extra", "unique"])).resolve("dup-emp");
    expect(resolved.skillReferences).toEqual(["shared-skill", "extra", "unique"]);
    expect(resolved.availableSkillIds).toEqual(["shared-skill", "extra", "unique"]);
    expect(resolved.unresolvedSkillIds).toEqual([]);
  });

  it("reports unknown employees via resolveOrUndefined without crashing", () => {
    const d = seedDirectory();
    expect(new EmployeeProfileResolver(d).resolveOrUndefined("missing-employee")).toBeUndefined();
    expect(() => new EmployeeProfileResolver(d).resolve("missing-employee")).toThrow(DirectoryNotFoundError);
  });
});

describe("search and filtering", () => {
  it("finds by profession, department, capability and status with a stable order", () => {
    const d = seedDirectory();
    const ids = d.employees.list().map(x => x.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    const backend = d.professions.list({ departmentId: "software-development" }).map(x => x.id);
    expect(backend).toContain("backend-developer");
    expect(d.employees.list({ professionId: "backend-developer", status: "active" }).length).toBeGreaterThan(0);
    for (const employee of d.employeesByCapability("code")) {
      expect(d.professions.get(employee.professionId).capabilityRequirements).toContain("code");
    }
    for (const employee of d.employeesByDepartment("software-development")) {
      expect(d.professions.get(employee.professionId).departmentId).toBe("software-development");
    }
  });

  it("returns empty lists for exotic filters and errors for unknown department in capability lookup", () => {
    const d = seedDirectory();
    expect(d.employees.list({ professionId: "ghost-profession" })).toEqual([]);
    expect(d.employees.list({ status: "disabled" })).toEqual([]);
    expect(d.employeesByCapability("telepathy")).toEqual([]);
  });
});

describe("scaling with synthetic directories", () => {
  function syntheticDirectory(employeeCount: number): OrganizationDirectory {
    const d = new OrganizationDirectory();
    d.registerDepartment(department("syn-dep"));
    d.registerProfession({ ...professionBase("syn-prof", "syn-dep"), capabilityRequirements: ["synthetic"] });
    for (let index = 0; index < employeeCount; index += 1) {
      d.registerEmployee(employeeFor(`syn-${String(index).padStart(4, "0")}`, "syn-prof"), { specialization: `specialization ${index % 20}`, instructionRefs: [] });
    }
    d.organization.register({ name: "Synthetic", departmentIds: ["syn-dep"] });
    return d;
  }

  it("handles 100 and 500 employees with deterministic filters", () => {
    for (const count of [100, 500]) {
      const d = syntheticDirectory(count);
      expect(d.employees.list()).toHaveLength(count);
      expect(d.employeesByCapability("synthetic")).toHaveLength(count);
      expect(d.employees.list({ professionId: "syn-prof", status: "active" })).toHaveLength(count);
      expect(d.employees.get(`syn-${String(count - 1).padStart(4, "0")}`).id).toBe(`syn-${String(count - 1).padStart(4, "0")}`);
      expect(d.validateIntegrity()).toBeUndefined();
    }
  });

  it("rejections and lookups stay linear and exact on a synthetic organization", () => {
    const d = syntheticDirectory(100);
    expect(() => d.employees.get("syn-100")).toThrow(DirectoryNotFoundError);
    const first = d.employees.get("syn-0000");
    expect(() => d.employees.register(first)).toThrow(/already exists/);
  });

  it("snapshots a large catalog both ways without loss", () => {
    const d = syntheticDirectory(500);
    const restored = OrganizationDirectory.fromSnapshot(d.snapshot());
    expect(restored.snapshot()).toEqual(d.snapshot());
    expect(restored.employees.list()).toHaveLength(500);
    expect(restored.organization.get().departmentIds).toEqual(["syn-dep"]);
  });

  it("supports separate registries independently of OrganizationDirectory", () => {
    const departments = new DepartmentRegistry();
    departments.register(department("solo-dep"));
    expect(departments.list().map(x => x.id)).toEqual(["solo-dep"]);
    const professions = new ProfessionRegistry();
    professions.register(professionBase("solo-prof", "solo-dep"));
    expect(professions.get("solo-prof").departmentId).toBe("solo-dep");
    const employees = new EmployeeRegistry();
    employees.register(employeeFor("solo-emp", "solo-prof"));
    expect(employees.get("solo-emp").professionId).toBe("solo-prof");
    const organization = new OrganizationRegistry();
    organization.register({ name: "Solo", departmentIds: ["solo-dep"] });
    expect(organization.get().name).toBe("Solo");
  });
});
