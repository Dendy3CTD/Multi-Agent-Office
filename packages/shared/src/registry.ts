import { type EntityId, type ModelId, type ProviderId, type RuntimeId, type SkillId } from "./common.js";
import type { ExpenseCategory, BudgetSnapshot } from "./budget.js";
import type { TaskComplexity } from "./tasks.js";

/**
 * Organization registry types (C01 Employee Registry, C02 Profession
 * Registry). Employees keep their own identity: assignments are runtime- and
 * model-agnostic references that never make an employee "belong to" one
 * adapter (ADR-MAO-011).
 */

/** Ordered cost/performance tier of a model; extends via `models.config.json`. */
export type ModelTier = "free" | "cheap" | "standard" | "strong";

/** Acceptance mode of a profession: rules, reviewer, or director review. */
export type AcceptanceMode = "auto" | "reviewer" | "director";

export type DepartmentStatus = "active" | "disabled";

/** Grouping of professions (10–12 departments); not a process, budget or slot. */
export interface Department {
  readonly id: EntityId;
  readonly name: string;
  readonly description?: string;
  readonly status: DepartmentStatus;
}

/** Referenceable text snippets that guide skill resolution for a profession. */
export type ProfessionStatus = "active" | "disabled";

/** Declarative competency profile; files in `professions/*.md` are the source of truth. */
export interface Profession {
  readonly id: EntityId;
  /** Semantic version of the profile (semver string). */
  readonly version: string;
  readonly name: string;
  readonly role: string;
  readonly departmentId: EntityId;
  readonly responsibilities: readonly string[];
  readonly baseInstructions: string;
  readonly skillTags: readonly string[];
  /** Model capabilities the profession requires (code, reasoning, vision, long-context). */
  readonly capabilityRequirements: readonly string[];
  /** hints for C07 Model Gateway: minimum tier and preferred models. */
  readonly modelHints: { readonly tier: ModelTier; readonly preferred?: readonly ModelId[] };
  readonly acceptancePolicy: { readonly mode: AcceptanceMode; readonly checks: readonly string[] };
  /** Inheritance from a parent profession profile (`extends:`). */
  readonly extends?: EntityId;
  readonly status: ProfessionStatus;
}

export type EmployeeStatus = "active" | "disabled";

/** A named instance of a profession hired into the office. */
export interface Employee {
  readonly id: EntityId;
  readonly professionId: EntityId;
  readonly displayName: string;
  /** Baseline model: minimum acceptable tier/capabilities, plus fallback (never a permanent binding). */
  readonly modelDefault: ModelId;
  /** Individual skills layered over resolver output. */
  readonly skillOverrides: readonly SkillId[];
  readonly visualCharacter?: string;
  readonly status: EmployeeStatus;
}

/** Forward-looking office-wide registry snapshot; no staffing data yet. */
export interface Organization {
  readonly name: string;
  /** 10–12 departments is the target; the structure stays extensible. */
  readonly departmentIds: readonly EntityId[];
  readonly description?: string;
}

/**
 * Assignment of an employee to execution work: a wish, not an ownership.
 * The actual model/runtime are decided per execution by C07/C17.
 */
export interface EmployeeAssignment {
  readonly employeeId: EntityId;
  readonly professionId?: EntityId;
  /** Human description of the expected contribution ("reviewer", "implementer", ...). */
  readonly role?: string;
}

/** Individual skill reference attached to an employee or a plan. */
export interface EmployeeSkillReference {
  readonly skillId: SkillId;
  /** Optional pinned version (semver string). */
  readonly version?: string;
  readonly source: "resolved" | "override";
}

/** Catalog entry owned by C07; runtime support is confirmed by C17 snapshots. */
export interface ModelDescriptor {
  readonly id: ModelId;
  readonly provider: ProviderId;
  readonly runtimeIds: readonly RuntimeId[];
  readonly tier: ModelTier;
  readonly capabilities: readonly string[];
  readonly relativeCost: number;
  readonly maxContextTokens?: number;
  readonly enabled: boolean;
  readonly paidExternal: boolean;
  readonly expenseCategory: Exclude<ExpenseCategory, "local">;
}

/** Read-only model quality projection supplied by C14. */
export interface ModelStatsView {
  readonly modelId: ModelId;
  readonly professionId?: EntityId;
  readonly taskType?: string;
  readonly attempts: number;
  readonly successes: number;
  readonly successRate?: number;
}

/** Selection returned by C07 and consumed by C06/C17. */
export interface ModelSelection {
  readonly modelId: ModelId;
  readonly runtimeId: RuntimeId;
  readonly provider: ProviderId;
  readonly expenseCategory: ExpenseCategory;
  readonly rationale: string;
  readonly fallbacks: readonly ModelId[];
  readonly estimatedCostUsd?: number;
  readonly estimatedTotalTokens?: number;
  readonly estimatedDurationMs?: number;
}

/** Minimal immutable input accepted from C05/C06 by the Model Gateway. */
export interface SubtaskBrief {
  readonly id?: EntityId;
  readonly title?: string;
  readonly brief?: string;
  readonly taskType?: string;
  readonly complexity: TaskComplexity;
  readonly requiredCapabilities?: readonly string[];
  readonly requiredTools?: readonly string[];
}

/** API-contract name retained as an alias for the implemented registry shape. */
export type ProfessionProfile = Profession;
export type EmployeeProfile = Employee;

/** API-contract name for the shared, read-only C08 projection. */
export type BudgetSnapshotView = BudgetSnapshot;
