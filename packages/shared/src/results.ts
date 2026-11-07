import { type ArtifactId, type EntityId, type SubtaskId, type Timestamp } from "./common.js";

/** Acceptance-check results (C12 contract data). Check payloads stay opaque here. */

export type ValidationVerdict = "pass" | "fail" | "partial";

export type ValidationRecommendation = "accept" | "retry" | "escalate" | "replan";

/** Report of one validation pass over a subtask result. */
export interface ValidationReport {
  readonly id: EntityId;
  readonly subtaskId: SubtaskId;
  /** 1-based attempt this report refers to. */
  readonly attempt: number;
  readonly checksRun: readonly string[];
  readonly verdict: ValidationVerdict;
  readonly reasons: readonly string[];
  readonly recommendation: ValidationRecommendation;
  readonly createdAt: Timestamp;
}

/** Prompt package assembled by C09 for one execution (opaque payload by design). */
export interface ExecutionContext {
  readonly subtaskId: SubtaskId;
  readonly prompt: string;
  readonly sections: readonly { readonly name: string; readonly tokenEstimate: number }[];
  readonly tokenEstimate: number;
  readonly trimmed: readonly { readonly section: string; readonly reason: string }[];
}

/** Kind of material produced by a subtask. */
export type ArtifactKind = "file" | "diff" | "report" | "image" | "dataset";

/** Manifest entry of a registered artifact; content lives in the project FS, never in DB. */
export interface ArtifactManifest {
  readonly id: ArtifactId;
  readonly subtaskId: SubtaskId;
  readonly kind: ArtifactKind;
  /** Path relative to the project root. */
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly producerEmployeeId: EntityId;
  readonly createdAt: Timestamp;
}
