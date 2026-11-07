/**
 * Common cross-domain types: identifiers, timestamps, result protocol and
 * error codes. This module imports nothing from the rest of the package.
 */
/** Builds a `Paginated` view over an already sliced array. */
export function paginate(items, total, pagination) {
    return { items, total, limit: pagination.limit, offset: pagination.offset };
}
/** Creates a structured {@link ValidationError}. */
export function validationError(message, options = {}) {
    return { code: options.code ?? "validation_error", message, field: options.field, details: options.details };
}
