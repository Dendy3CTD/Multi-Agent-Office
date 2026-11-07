import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "../src/events.js";
import { createEventEnvelope } from "../src/events.js";
import { sessionIdFromEvent } from "../src/session.js";

function envelope(payload: Record<string, unknown>, metadata: Record<string, unknown> = {}): EventEnvelope {
  return createEventEnvelope({
    id: "evt-1",
    type: "subtask_started",
    ts: "2026-11-04T10:00:00Z",
    metadata,
    payload,
  });
}

describe("createEventEnvelope", () => {
  it("normalizes the timestamp and freezes the envelope", () => {
    const event = envelope({ ok: true });
    expect(event.ts).toBe("2026-11-04T10:00:00.000Z");
    expect(event.schemaVersion).toBe(1);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.metadata)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
  });

  it("rejects invalid ids and timestamps", () => {
    expect(() => createEventEnvelope({ id: "", type: "task_created", ts: "2026-11-04T10:00:00Z" })).toThrow(TypeError);
    expect(() => createEventEnvelope({ id: "evt-2", type: "task_created", ts: "nope" })).toThrow(/ISO 8601/);
    expect(() => createEventEnvelope({ id: "evt-3", type: "", ts: "2026-11-04T10:00:00Z" })).toThrow(/event\.type/);
  });
});

describe("sessionIdFromEvent", () => {
  it("reads sessionId straight from metadata", () => {
    expect(sessionIdFromEvent(envelope({}, { sessionId: "ses-open-1" }))).toBe("ses-open-1");
  });

  it("reads adapters' common payload keys (OpenCode and Codex naming)", () => {
    expect(sessionIdFromEvent(envelope({ sessionId: "ses-2" }))).toBe("ses-2");
    expect(sessionIdFromEvent(envelope({ externalSessionId: "codex-ses-3" }))).toBe("codex-ses-3");
    expect(sessionIdFromEvent(envelope({ opencodeSessionId: "oc-ses-4" }))).toBe("oc-ses-4");
    expect(sessionIdFromEvent(envelope({ session: { sessionId: "nested-5" } }))).toBe("nested-5");
  });

  it("returns undefined when no session id is present", () => {
    expect(sessionIdFromEvent(envelope({ text: "done" }))).toBeUndefined();
  });

  it("prefers metadata over payload and ignores non-strings", () => {
    expect(sessionIdFromEvent(envelope({ sessionId: 42 }, { sessionId: "meta-wins" }))).toBe("meta-wins");
  });
});
