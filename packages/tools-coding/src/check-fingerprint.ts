import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";

const HOST_WORKSPACE_ENTRIES = new Set([".mao", ".mao-coding-home", ".mao-coding-tmp"]);
const PYTHON_CACHE_DIRECTORIES = new Set(["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);

/** Hashes project contents without following symlinks or including generated Python caches. */
export async function codingCheckFingerprint(workspaceRoot: string): Promise<string> {
  const root = await realpath(workspaceRoot);
  const hash = createHash("sha256");
  hash.update(JSON.stringify(["mao-coding-check-v2", root]));

  async function visit(directory: string, prefix: string): Promise<void> {
    const before = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || await realpath(directory) !== directory) {
      throw new Error("A check workspace directory no longer resolves in place.");
    }
    const entries = (await readdir(directory)).sort();
    for (const name of entries) {
      if (name === ".git" || (!prefix && HOST_WORKSPACE_ENTRIES.has(name))) continue;
      const path = join(directory, name);
      const local = prefix ? `${prefix}/${name}` : name;
      const info = await lstat(path, { bigint: true });
      if (info.isDirectory()) {
        if (PYTHON_CACHE_DIRECTORIES.has(name)) continue;
        hash.update(JSON.stringify([local, "directory"]));
        await visit(path, local);
      } else if (info.isSymbolicLink()) {
        const target = await readlink(path);
        if (!sameVersion(info, await lstat(path, { bigint: true }))) {
          throw new Error("A check workspace symlink changed during fingerprinting.");
        }
        hash.update(JSON.stringify([local, "link", target]));
      } else if (info.isFile()) {
        if (/\.py[co]$/.test(name)) continue;
        hash.update(JSON.stringify([local, "file", await fileDigest(path, info)]));
      } else {
        throw new Error("A check workspace entry cannot be fingerprinted.");
      }
    }
    if (!sameVersion(before, await lstat(directory, { bigint: true }))) {
      throw new Error("A check workspace directory changed during fingerprinting.");
    }
  }

  await visit(root, "");
  return hash.digest("hex");
}

async function fileDigest(path: string, expected: BigIntStats): Promise<string> {
  if (await realpath(path) !== path) throw new Error("A check workspace file no longer resolves in place.");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameVersion(expected, before)) {
      throw new Error("A check workspace file changed before fingerprinting.");
    }
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    if (!sameVersion(before, await handle.stat({ bigint: true }))) {
      throw new Error("A check workspace file changed during fingerprinting.");
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

function sameVersion(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
