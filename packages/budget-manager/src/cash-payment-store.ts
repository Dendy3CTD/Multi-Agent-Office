import { mkdir, open, readFile, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { BudgetStoreError, CashPaymentConflictError } from "./errors.js";
import type { CashPayment, CashPaymentStore } from "./types.js";
import { normalizeCashPayment, samePayment, tryNormalizeCashPayment } from "./validation.js";

interface PaymentPathState {
  queue: Promise<void>;
  ready?: Promise<void>;
  payments: Map<string, CashPayment>;
}

/** Shared per resolved path, so several instances in one process serialize on one queue. */
const states = new Map<string, PaymentPathState>();

function stateFor(path: string): PaymentPathState {
  let state = states.get(path);
  if (!state) {
    state = { queue: Promise.resolve(), payments: new Map() };
    states.set(path, state);
  }
  return state;
}

async function endsWithNewline(handle: FileHandle, size: number): Promise<boolean> {
  const byte = Buffer.alloc(1);
  const { bytesRead } = await handle.read(byte, 0, 1, size - 1);
  return bytesRead === 1 && byte[0] === 0x0a;
}

/**
 * Append-only JSONL journal of cash payments.
 *
 * - One JSON object per line, whitelisted fields only (paymentId, amountRub, timestamp).
 * - Identical re-appends are ignored (no duplicate spend); conflicting data for the same
 *   paymentId throws CashPaymentConflictError.
 * - Damaged or invalid lines are skipped while reading.
 * - Operations are serialized inside the current Node.js process only.
 */
export class JsonlCashPaymentStore implements CashPaymentStore {
  readonly path: string;
  private readonly state: PaymentPathState;

  constructor(path: string) {
    if (typeof path !== "string" || !isAbsolute(path)) throw new TypeError("Cash payment journal path must be absolute");
    this.path = resolve(path);
    this.state = stateFor(this.path);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.state.queue.then(operation, operation);
    this.state.queue = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  /** Loads the journal once; a failed load is retried on the next call. */
  private ready(): Promise<void> {
    this.state.ready ??= this.loadJournal().catch((error: unknown) => {
      this.state.ready = undefined;
      throw error;
    });
    return this.state.ready;
  }

  private async loadJournal(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new BudgetStoreError("Unable to read cash payment journal", error);
    }
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // damaged line: skipped, never executed
      }
      const payment = tryNormalizeCashPayment(parsed);
      if (!payment) continue;
      const existing = this.state.payments.get(payment.paymentId);
      if (!existing) {
        this.state.payments.set(payment.paymentId, payment);
      } else if (!samePayment(existing, payment)) {
        // Silently choosing one of two conflicting money records would hide an error.
        throw new CashPaymentConflictError(payment.paymentId, "has conflicting records in the journal");
      }
    }
  }

  async appendPayment(input: CashPayment): Promise<boolean> {
    const payment = normalizeCashPayment(input);
    return this.enqueue(async () => {
      await this.ready();
      const existing = this.state.payments.get(payment.paymentId);
      if (existing) {
        if (samePayment(existing, payment)) return false;
        throw new CashPaymentConflictError(payment.paymentId);
      }
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const handle = await open(this.path, "a+", 0o600);
      try {
        const { size } = await handle.stat();
        // If a previous write was cut short, start on a fresh line so the new record is not glued to it.
        const separator = size > 0 && !(await endsWithNewline(handle, size)) ? "\n" : "";
        await handle.appendFile(`${separator}${JSON.stringify(payment)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.state.payments.set(payment.paymentId, payment);
      return true;
    });
  }

  async readPayments(): Promise<CashPayment[]> {
    return this.enqueue(async () => {
      await this.ready();
      return [...this.state.payments.values()].map((payment) => ({ ...payment }));
    });
  }
}
