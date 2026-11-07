import { describe, expect, it } from "vitest";
import {
  ISO_TIMESTAMP_PATTERN,
  MODEL_ID_PATTERN,
  assertIdentifier,
  assertModelId,
  assertOptionalIdentifier,
  assertRuntimeId,
  assertTimestamp,
  validateIdentifier,
} from "../src/ids.js";

describe("assertIdentifier", () => {
  it("accepts canonical identifiers", () => {
    expect(assertIdentifier("taskId", "task-123")).toBe("task-123");
    expect(assertIdentifier("id", "A0.9_:b")).toBe("A0.9_:b");
  });

  it("rejects empty, oversized and bad-prefix identifiers", () => {
    expect(() => assertIdentifier("id", "")).toThrow(TypeError);
    expect(() => assertIdentifier("id", "-abc")).toThrow(/letters, digits/);
    expect(() => assertIdentifier("id", `${"a".repeat(129)}`)).toThrow(TypeError);
    expect(() => assertIdentifier("id", 42)).toThrow(TypeError);
  });
});

describe("assertOptionalIdentifier", () => {
  it("passes undefined through and validates otherwise", () => {
    expect(assertOptionalIdentifier("id", undefined)).toBeUndefined();
    expect(assertOptionalIdentifier("id", "session-1")).toBe("session-1");
    expect(() => assertOptionalIdentifier("id", "@bad")).toThrow(TypeError);
  });
});

describe("assertModelId", () => {
  it("accepts provider-qualified model ids", () => {
    expect(assertModelId("model", "opencode-go/glm-5.3-flash")).toBe("opencode-go/glm-5.3-flash");
    expect(MODEL_ID_PATTERN.test("chatgpt-plus/gpt-5")).toBe(true);
  });

  it("rejects unqualified or malformed ids", () => {
    expect(() => assertModelId("model", "glm-5.3-flash")).toThrow(/provider\/model/);
    expect(() => assertModelId("model", "/leading-slash")).toThrow(TypeError);
    expect(assertModelId("model", "opencode-go/beam-free")).toBe("opencode-go/beam-free");
  });
});

describe("assertRuntimeId", () => {
  it("accepts short slugs and rejects slashes", () => {
    expect(assertRuntimeId("runtime", "opencode")).toBe("opencode");
    expect(assertRuntimeId("runtime", "codex")).toBe("codex");
    expect(() => assertRuntimeId("runtime", "provider/model")).toThrow(TypeError);
  });
});

describe("assertTimestamp", () => {
  it("accepts ISO timestamps and normalizes to UTC", () => {
    expect(assertTimestamp("ts", "2026-11-04T12:00:00Z")).toBe("2026-11-04T12:00:00.000Z");
    expect(assertTimestamp("ts", "2026-11-04T15:00:00+03:00")).toBe("2026-11-04T12:00:00.000Z");
    expect(ISO_TIMESTAMP_PATTERN.test("2026-11-04T12:00:00.123Z")).toBe(true);
  });

  it("rejects dates without explicit zone", () => {
    expect(() => assertTimestamp("ts", "2026-11-04")).toThrow(/ISO 8601/);
    expect(() => assertTimestamp("ts", "not-a-date")).toThrow(TypeError);
  });
});

describe("validateIdentifier (result-based)", () => {
  it("returns ok/error without throwing", () => {
    const ok = validateIdentifier("id", "abc");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value).toBe("abc");
    const bad = validateIdentifier("id", "!");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("validation_error");
  });
});
