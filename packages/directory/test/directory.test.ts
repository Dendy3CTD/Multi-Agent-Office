import { describe, expect, it } from "vitest";
import { DirectoryConflictError, DirectoryReferenceError, EmployeeProfileResolver, OrganizationDirectory, seedDirectory } from "../src/index.js";

describe("organization directory", () => {
  it("seeds 12 departments, professions and 100+ differentiated employees", () => {
    const directory = seedDirectory();
    expect(directory.departments.list()).toHaveLength(12);
    expect(directory.professions.list()).toHaveLength(20);
    expect(directory.employees.list()).toHaveLength(113);
    expect(new Set(directory.employees.list().map(x => x.id)).size).toBe(113);
    expect(new Set(directory.employees.records().map(x => x.metadata.specialization)).size).toBeGreaterThan(1);
  });

  it("supports deterministic lookup and capability filtering", () => {
    const a = seedDirectory(); const b = seedDirectory();
    expect(a.employees.list()).toEqual(b.employees.list());
    expect(a.employeesByDepartment("software-development").every(x => x.professionId !== "director")).toBe(true);
    expect(a.employeesByCapability("code").length).toBeGreaterThan(0);
  });

  it("rejects duplicate ids and broken references", () => {
    const d = seedDirectory(); const employee = d.employees.get("employee-001");
    expect(() => d.registerEmployee(employee)).toThrow(DirectoryConflictError);
    expect(() => d.registerEmployee({ ...employee, id: "new-employee", professionId: "missing" })).toThrow(DirectoryReferenceError);
    expect(() => d.registerProfession({ ...d.professions.get("director"), id: "child", extends: "missing" })).toThrow(DirectoryReferenceError);
  });

  it("blocks deletion of referenced entities and preserves snapshots", () => {
    const d = seedDirectory();
    expect(() => d.removeProfession("director")).toThrow(DirectoryReferenceError);
    expect(() => d.removeDepartment("management")).toThrow(DirectoryReferenceError);
    const employee = d.employees.get("employee-001");
    expect(() => (employee as { displayName: string }).displayName = "mutated").toThrow();
    expect(d.employees.get("employee-001").displayName).not.toBe("mutated");
  });

  it("resolves profile metadata without claiming planned skills are available", () => {
    const d = seedDirectory(); const result = new EmployeeProfileResolver(d).resolve("employee-001");
    expect(result.department.id).toBe("management");
    expect(result.instructionRefs.length).toBeGreaterThan(0);
    expect(result.availableSkillIds).toEqual([]);
    expect(result.unresolvedSkillIds.length).toBeGreaterThan(0);
  });

  it("round-trips a read-only snapshot", () => {
    const first = seedDirectory(); const restored = OrganizationDirectory.fromSnapshot(first.snapshot());
    expect(restored.snapshot()).toEqual(first.snapshot());
  });
});
