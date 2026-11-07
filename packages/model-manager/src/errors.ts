import type { ModelId, RuntimeId } from "@open-agent-office/shared";

export type ModelRoutingErrorCode =
  | "catalog_empty"
  | "model_not_found"
  | "no_runtime_support"
  | "missing_capability"
  | "context_limit"
  | "budget_blocked"
  | "subscription_limit"
  | "paid_external_requires_approval"
  | "no_eligible_model"
  | "invalid_catalog"
  | "invalid_input";

export interface RoutingDiagnostic {
  readonly modelId?: ModelId;
  readonly runtimeId?: RuntimeId;
  readonly reason: string;
}

export class ModelRoutingError extends Error {
  readonly code: ModelRoutingErrorCode;
  readonly diagnostics: readonly RoutingDiagnostic[];

  constructor(code: ModelRoutingErrorCode, message: string, diagnostics: readonly RoutingDiagnostic[] = []) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

export class CatalogValidationError extends ModelRoutingError {
  constructor(message: string, diagnostics: readonly RoutingDiagnostic[] = []) {
    super("invalid_catalog", message, diagnostics);
  }
}
