export class BudgetExceededError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "BudgetExceededError";
    this.reason = reason;
  }
}

export class BudgetStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "BudgetStoreError";
  }
}

/** Raised when the same usage eventId is recorded again with different data. */
export class UsageEventConflictError extends BudgetStoreError {
  readonly eventId: string;
  constructor(eventId: string, detail = "already exists with different data") {
    super(`Usage event ${eventId} ${detail}`);
    this.name = "UsageEventConflictError";
    this.eventId = eventId;
  }
}

/** Raised when the same paymentId is recorded again with different data. */
export class CashPaymentConflictError extends BudgetStoreError {
  readonly paymentId: string;
  constructor(paymentId: string, detail = "already exists with different data") {
    super(`Cash payment ${paymentId} ${detail}`);
    this.name = "CashPaymentConflictError";
    this.paymentId = paymentId;
  }
}
