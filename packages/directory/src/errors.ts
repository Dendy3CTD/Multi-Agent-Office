export type DirectoryErrorCode = "not_found" | "identifier_conflict" | "invalid_reference" | "validation_error";

export class DirectoryError extends Error {
  readonly code: DirectoryErrorCode;
  readonly entityId?: string;
  constructor(code: DirectoryErrorCode, message: string, entityId?: string) {
    super(message); this.name = "DirectoryError"; this.code = code; this.entityId = entityId;
  }
}
export class DirectoryNotFoundError extends DirectoryError { constructor(kind: string, id: string) { super("not_found", `${kind} not found: ${id}`, id); } }
export class DirectoryConflictError extends DirectoryError { constructor(kind: string, id: string) { super("identifier_conflict", `${kind} already exists: ${id}`, id); } }
export class DirectoryReferenceError extends DirectoryError { constructor(message: string, id?: string) { super("invalid_reference", message, id); } }
