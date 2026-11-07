import * as shared from "../src/index.js";
import { describe, expect, it } from "vitest";

/**
 * Public surface smoke test: the set of exported runtime values from the
 * single entry point (API_CONTRACTS §1) must exactly match wave S2-0 scope —
 * pure validation helpers and constants only. All other S2-0 contracts
 * (RuntimeAdapter, RuntimeCapabilities, Employee, Task, BudgetGuardView,
 * EventEnvelope, ...) are TypeScript types, which compile away and are
 * therefore validated by the typecheck, not here.
 */
describe("shared public exports", () => {
  const EXPECTED_VALUE_EXPORTS = [
    "EVENT_SCHEMA_VERSION",
    "IDENTIFIER_PATTERN",
    "TASK_ID_PATTERN",
    "MODEL_ID_PATTERN",
    "RUNTIME_ID_PATTERN",
    "ISO_TIMESTAMP_PATTERN",
    "assertIdentifier",
    "assertOptionalIdentifier",
    "assertModelId",
    "assertRuntimeId",
    "assertTimestamp",
    "validateIdentifier",
    "validateTimestamp",
    "redactSecrets",
    "sanitizeValue",
    "REDACTION_MARKER",
    "REDACTION_SENSITIVE_KEY",
    "paginate",
    "validationError",
    "createEventEnvelope",
    "sessionIdFromEvent",
  ].sort();

  it("exports exactly the planned runtime values", () => {
    expect(Object.keys(shared).sort()).toEqual(EXPECTED_VALUE_EXPORTS);
  });

  it("contains no classes or adapter instances (values are functions and constants)", () => {
    for (const value of Object.values(shared)) {
      const kind = typeof value;
      expect(kind === "function" || kind === "number" || kind === "object" || kind === "string").toBe(true);
      if (typeof value === "function") {
        // Plain functions, not class constructors: `new` must be meaningless.
        expect(value.toString().startsWith("class")).toBe(false);
      }
    }
  });

  it("exposes key helper behaviour through the entry point", () => {
    expect(shared.assertIdentifier("id", "task-1")).toBe("task-1");
    expect(shared.redactSecrets('{"token":"x"}')).toBe('{"token":"[REDACTED]"}');
    expect(shared.sessionIdFromEvent(
      shared.createEventEnvelope({ id: "e1", type: "subtask_started", ts: "2026-11-04T10:00:00Z", payload: { sessionId: "s-1" } }),
    )).toBe("s-1");
  });
});
