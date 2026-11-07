import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureLocalToken, parseLocalServerConfiguration } from "../src/start.js";

describe("local server startup configuration", () => {
  it("uses loopback and rejects public hosts and invalid ports", () => {
    expect(parseLocalServerConfiguration({ MAO_PORT: "3001", MAO_TOKEN_FILE: "/tmp/mao-token" })).toMatchObject({ host: "127.0.0.1", port: 3001 });
    expect(() => parseLocalServerConfiguration({ MAO_HOST: "0.0.0.0" })).toThrow(/localhost/i);
    expect(() => parseLocalServerConfiguration({ MAO_PORT: "70000" })).toThrow(/port/i);
    expect(() => parseLocalServerConfiguration({ MAO_PORT: "not-a-port" })).toThrow(/port/i);
  });

  it("bootstraps an owner-only token and preserves the existing value", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oao-token-"));
    const path = join(directory, "config", "token");
    const created = await ensureLocalToken(path);
    expect(created.length).toBeGreaterThan(20);
    expect((await stat(path)).mode & 0o077).toBe(0);
    expect((await readFile(path, "utf8")).trim()).toBe(created);
    const second = await ensureLocalToken(path);
    expect(second).toBe(created);
    expect((await readFile(path, "utf8")).match(new RegExp(created, "g"))).toHaveLength(1);
  });

  it("rejects a token path inside the repository", () => {
    expect(() => parseLocalServerConfiguration({ MAO_TOKEN_FILE: join(process.cwd(), "token") })).toThrow(/repository/i);
  });
});
