import { describe, expect, it } from "vitest";

import {
  createProviderConnection,
  getProviderConnections,
  deleteProviderConnection,
  updateProviderConnection,
} from "../../src/lib/db/index.js";

// #4311: POST /api/providers was O(pool) per insert. Inside one transaction it
// read the whole pool AND renumbered every row's priority, so a 5k-key import
// was O(n*m) — ~25M statements at a 5k pool — and every parallel writer
// serialized on the same transaction. On top of that, an apikey name collision
// silently overwrote the stored key with no 409.
//
// The test DB persists across tests in a file, so each case uses its own
// provider alias; priorities are per-provider.

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
    // Unique alias per run: the DB persists across runs, so a fixed alias
    // would accumulate rows and make this assertion depend on test order.
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
  // Seeded once: these cases each mutate the SAME row, so a per-test seed
  // would make the later assertions depend on earlier ones.
  const P = `openai-compatible-clash-${Date.now()}`;
  const original = (async () => {
    await seed(P, 1);
    return (await getProviderConnections({ provider: P }))[0];
  })();

  it("throws a typed conflict instead of overwriting, when overwrite is refused", async () => {
    const orig = await original;
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
    const orig = await original;
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
    const orig = await original;
    const updated = await createProviderConnection({
      provider: P,
      authType: "apikey",
      name: orig.name,
      apiKey: "LEGACY-PATH-KEY",
    });
    expect(updated.id).toBe(orig.id);
  });

  it("does not collide across different providers", async () => {
    const orig = await original;
    const other = await createProviderConnection({
      provider: "openai-compatible-other",
      authType: "apikey",
      name: orig.name,
      apiKey: "other-key",
    });
    expect(other.id).not.toBe(orig.id);
  });
});
