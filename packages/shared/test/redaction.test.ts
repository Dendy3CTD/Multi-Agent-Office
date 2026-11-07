import { describe, expect, it } from "vitest";
import { REDACTION_MARKER, redactSecrets, sanitizeValue } from "../src/redaction.js";

describe("redactSecrets", () => {
  it("redacts bearer tokens", () => {
    expect(redactSecrets("Authorization: Bearer sk-abc123 rest")).toBe(`Authorization: Bearer ${REDACTION_MARKER} rest`);
  });

  it("redacts api keys and assignment forms", () => {
    expect(redactSecrets("api_key = sk-xyz;")).toBe(`api_key = ${REDACTION_MARKER};`);
    expect(redactSecrets("token: hunter2;")).toBe(`token: ${REDACTION_MARKER};`);
    expect(redactSecrets('{"password":"s3cret"}')).toBe(`{"password":"${REDACTION_MARKER}"}`);
  });

  it("redacts access_token forms", () => {
    expect(redactSecrets("access_token=abc.def")).toBe(`access_token=${REDACTION_MARKER}`);
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("simple task: write docs")).toBe("simple task: write docs");
  });
});

describe("sanitizeValue", () => {
  it("collapses sensitive keys to the marker", () => {
    expect(sanitizeValue({ token: "abc", password: "def" })).toEqual({ token: REDACTION_MARKER, password: REDACTION_MARKER });
  });

  it("redacts nested values (arrays and objects)", () => {
    const input = {
      list: ["Authorization: Bearer aa11", { access_token: "bb22" }],
      meta: { note: "safe", secret: "gone" },
    };
    expect(sanitizeValue(input)).toEqual({
      list: [`Authorization: Bearer ${REDACTION_MARKER}`, { access_token: REDACTION_MARKER }],
      meta: { note: "safe", secret: REDACTION_MARKER },
    });
  });

  it("preserves scalars, Dates and null", () => {
    const date = new Date(0);
    expect(sanitizeValue({ d: date, n: 42, b: true, z: null })).toEqual({ d: date, n: 42, b: true, z: null });
    expect(sanitizeValue(Math.PI)).toBe(Math.PI);
  });
});
