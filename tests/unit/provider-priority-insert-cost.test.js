import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// #4311: POST /api/providers was O(pool) per insert. Inside one transaction it
// read the whole pool AND renumbered every row's priority, so a 5k-key import
// was O(n*m) — ~25M statements at a 5k pool — and every parallel writer
// serialized on the same transaction. On top of that, an apikey name collision
// silently overwrote the stored key with no 409.
//
// DB isolation: upstream removed the original version of this test (57c04f00)
// because it imported src/lib/db without DATA_DIR isolation and seeded rows into
// the developer's real ~/.9router database. This version points DATA_DIR at a
// throwaway temp dir BEFORE the DB module is first imported, so it never touches
// real data. The temp DB is shared across cases in this file, so each case uses
// its own provider alias; priorities are per-provider.

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let createProviderConnection;
let getProviderConnections;
let deleteProviderConnection;
let updateProviderConnection;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-priority-insert-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  ({
    createProviderConnection,
    getProviderConnections,
    deleteProviderConnection,
    updateProviderConnection,
  } = await import("../../src/lib/db/index.js"));
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; the OS temp dir is reaped eventually.
  }
});

async function seed(provider, n) {
  for (let i = 0; i < n; i++) {
    await createProviderConnection({
      provider,
      authType: "apikey",
      name: `seed-${i}`,
      apiKey: `k${i}`,
    });
  }
}

describe("provider insert is O(1) in pool size (#4311)", () => {
  it("never touches the real user data dir", () => {
    expect(process.env.DATA_DIR).toBe(tempDir);
    expect(tempDir.startsWith(os.tmpdir())).toBe(true);
  });

  it("assigns sequential priorities without a renumber pass", async () => {
    const P = `openai-compatible-seq-${Date.now()}`;
    await seed(P, 3);
    const list = await getProviderConnections({ provider: P });
    expect(list.map((c) => c.name)).toEqual(["seed-0", "seed-1", "seed-2"]);
    expect(list.map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("keeps a large pool in insertion order", async () => {
    const P = `openai-compatible-ord-${Date.now()}`;
    await seed(P, 60);
    const list = await getProviderConnections({ provider: P });
    expect(list).toHaveLength(60);
    // The bug showed up as reordering once the pool grew past a few rows.
    expect(list[0].name).toBe("seed-0");
    expect(list[59].name).toBe("seed-59");
    for (let i = 1; i < list.length; i++) {
      expect(list[i].priority).toBeGreaterThan(list[i - 1].priority);
    }
  });

  it("still renumbers on delete, so gaps do not accumulate", async () => {
    const P = `openai-compatible-del-${Date.now()}`;
    await seed(P, 4);
    const before = await getProviderConnections({ provider: P });
    await deleteProviderConnection(before[0].id);
    const after = await getProviderConnections({ provider: P });
    expect(after.map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("still renumbers on an explicit priority update", async () => {
    const P = `openai-compatible-upd-${Date.now()}`;
    await seed(P, 4);
    await new Promise((r) => setTimeout(r, 10));
    const list = await getProviderConnections({ provider: P });
    // Move the last one to the front.
    await updateProviderConnection(list[3].id, { priority: 1 });
    const after = await getProviderConnections({ provider: P });
    expect(after[0].name).toBe("seed-3");
  });
});

describe("name collision no longer destroys a key silently (#4311)", () => {
  // Seeded once (lazily, after the temp DB exists): these cases each mutate the
  // SAME row, so a per-test seed would make later assertions order-dependent.
  const P = `openai-compatible-clash-${Date.now()}`;
  let originalRow;

  beforeAll(async () => {
    await seed(P, 1);
    originalRow = (await getProviderConnections({ provider: P }))[0];
  });

  it("throws a typed conflict instead of overwriting, when overwrite is refused", async () => {
    const orig = originalRow;
    await expect(
      createProviderConnection({
        provider: P,
        authType: "apikey",
        name: orig.name,
        apiKey: "REPLACEMENT-KEY",
        allowOverwrite: false,
      })
    ).rejects.toMatchObject({ code: "PROVIDER_NAME_CONFLICT", existingId: orig.id });

    // The stored key must be untouched.
    const after = (await getProviderConnections({ provider: P }))[0];
    expect(after.apiKey).toBe(orig.apiKey);
  });

  it("still overwrites when the caller opts in", async () => {
    const orig = originalRow;
    const updated = await createProviderConnection({
      provider: P,
      authType: "apikey",
      name: orig.name,
      apiKey: "REPLACEMENT-KEY",
      allowOverwrite: true,
    });
    expect(updated.id).toBe(orig.id);
    const after = (await getProviderConnections({ provider: P }))[0];
    expect(after.apiKey).toBe("REPLACEMENT-KEY");
  });

  it("defaults to the previous overwrite behaviour for existing callers", async () => {
    // Every other call site in the repo (oauth routes, bulk import) omits the
    // flag, so they must keep working exactly as before.
    const orig = originalRow;
    const updated = await createProviderConnection({
      provider: P,
      authType: "apikey",
      name: orig.name,
      apiKey: "LEGACY-PATH-KEY",
    });
    expect(updated.id).toBe(orig.id);
  });

  it("does not collide across different providers", async () => {
    const orig = originalRow;
    const other = await createProviderConnection({
      provider: "openai-compatible-other",
      authType: "apikey",
      name: orig.name,
      apiKey: "other-key",
    });
    expect(other.id).not.toBe(orig.id);
  });
});
