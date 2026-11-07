import { assertIdentifier, assertModelId, type Department, type Employee, type Profession } from "@open-agent-office/shared";
import { DirectoryError } from "./errors.js";

const nonEmpty = (field: string, value: unknown) => { if (typeof value !== "string" || !value.trim()) throw new DirectoryError("validation_error", `${field} must be non-empty`); };
export function validateDepartment(value: Department): void {
  assertIdentifier("department.id", value.id); nonEmpty("department.name", value.name);
  if (!["active", "disabled"].includes(value.status)) throw new DirectoryError("validation_error", "invalid department status");
}
export function validateProfession(value: Profession): void {
  assertIdentifier("profession.id", value.id); nonEmpty("profession.name", value.name); nonEmpty("profession.version", value.version);
  assertIdentifier("profession.departmentId", value.departmentId); nonEmpty("profession.baseInstructions", value.baseInstructions);
  if (!["free", "cheap", "standard", "strong"].includes(value.modelHints.tier)) throw new DirectoryError("validation_error", "invalid profession tier");
  for (const skill of value.skillTags) assertIdentifier("profession.skillTags", skill);
  for (const capability of value.capabilityRequirements) nonEmpty("profession.capabilityRequirements", capability);
  if (value.extends !== undefined) assertIdentifier("profession.extends", value.extends);
}
export function validateEmployee(value: Employee): void {
  assertIdentifier("employee.id", value.id); assertIdentifier("employee.professionId", value.professionId);
  nonEmpty("employee.displayName", value.displayName); assertModelId("employee.modelDefault", value.modelDefault);
  for (const skill of value.skillOverrides) assertIdentifier("employee.skillOverrides", skill);
  if (!["active", "disabled"].includes(value.status)) throw new DirectoryError("validation_error", "invalid employee status");
}
