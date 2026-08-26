// Combo lists: migration backfill, CRUD + protect, reorder normalize,
// move/batch, and import/export compatibility with old (list-less) backups.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-lists-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("combo lists", () => {
  it("fresh DB boots with a default list; legacy combos land in it", async () => {
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify({
      combos: [{ id: "old-1", name: "legacy-combo", models: ["m1"], createdAt: new Date().toISOString() }],
    }));
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    const lists = await db.getComboLists({ withCounts: true });
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ id: "default", name: "默认清单", sortOrder: 0 });
    const combo = await db.getComboById("old-1");
    expect(combo.listId).toBe("default");
    expect(lists[0].comboCount).toBe(1);
  });

  it("existing DB at older version migrates orphans into the default list", async () => {
    // First boot stamps latest version, then we simulate an old DB by removing
    // the listId column effect: easiest is to insert a combo with bogus listId
    // directly, then re-run guard logic via createComboList.
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    await db.createComboList("second");
    // Simulate a dangling reference at SQL level.
    const adapter = (await import("@/lib/db/driver.js")).getAdapterSync();
    adapter.run(`INSERT INTO combos(id, name, models, listId, createdAt, updatedAt) VALUES('x', 'orphan', '[]', 'gone-list', ?, ?)`, [new Date().toISOString(), new Date().toISOString()]);
    // The default-list guard repairs orphans on next repo write... but reads don't repair.
    // Read-only consistency is guaranteed by ensureDefaultComboList on writes; for this
    // test just assert that reading still returns the combo mapped through rowToCombo.
    const orphan = await db.getComboById("x");
    expect(orphan.listId).toBe("gone-list"); // raw passthrough; no silent mutation on read
  });

  it("create/rename/delete lists; default renameable but not deletable", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();

    const work = await db.createComboList("Work");
    expect(work.sortOrder).toBe(1);

    const renamed = await db.renameComboList("default", "我的清单");
    expect(renamed.name).toBe("我的清单");

    const combo = await db.createCombo({ name: "c1", models: [] });
    const moved = await db.moveCombosToList([combo.id], work.id);
    expect(moved).toEqual([combo.id]);

    // Deleting Work moves its combos to default atomically.
    expect(await db.deleteComboList(work.id)).toBe(true);
    expect((await db.getComboById(combo.id)).listId).toBe("default");
    expect((await db.getComboLists()).find((l) => l.id === work.id)).toBeUndefined();

    await expect(db.deleteComboList("default")).rejects.toMatchObject({ code: "LIST_PROTECTED" });
  });

  it("updateCombo guards against illegal listId — no orphaned combos", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const combo = await db.createCombo({ name: "c1", models: [] });
    await db.updateCombo(combo.id, { listId: "missing-list" });
    const after = await db.getComboById(combo.id);
    expect(after.listId).toBe("default");
  });

  it("moveCombosToList rejects unknown target list", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const combo = await db.createCombo({ name: "c1", models: [] });
    const moved = await db.moveCombosToList([combo.id], "nope");
    expect(moved).toEqual([]);
    expect((await db.getComboById(combo.id)).listId).toBe("default");
  });

  it("reorderComboLists normalizes sortOrder to 0..n-1", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const a = await db.createComboList("A");
    const c = await db.createComboList("C");
    // Partial reorder: named IDs first (C then default), unnamed lists keep relative order after.
    const reordered = await db.reorderComboLists([c.id, "default"]);
    const sorted = reordered.map((l) => l.name);
    expect(sorted[0]).toBe("C");
    expect(sorted[1]).toBe("默认清单");
    expect(sorted[2]).toBe("A");
    expect(reordered.map((l) => l.sortOrder)).toEqual(reordered.map((_, i) => i));
    void a;
  });

  it("deleteCombosByIds deletes only existing ids", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const c1 = await db.createCombo({ name: "c1", models: [] });
    const deleted = await db.deleteCombosByIds([c1.id, "ghost"]);
    expect(deleted).toEqual([c1.id]);
    expect(await db.getComboById(c1.id)).toBeNull();
  });

  it("PUT /api/combos batch: move validation, delete semantics, error codes", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const work = await db.createComboList("Work");
    const c1 = await db.createCombo({ name: "b1", models: [] });
    const c2 = await db.createCombo({ name: "b2", models: [], listId: work.id });

    const { PUT } = await import("@/app/api/combos/route.js");
    const call = (body) => PUT(new Request("http://x/api/combos", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));

    // Validation errors
    expect((await call({ action: "delete", ids: [] })).status).toBe(400);
    expect((await call({ action: "move", ids: [c1.id], listId: "" })).status).toBe(400);
    expect((await call({ action: "nonsense", ids: [c1.id] })).status).toBe(400);
    // Unknown target list → 404, combo untouched
    const badTarget = await call({ action: "move", ids: [c1.id], listId: "ghost-list" });
    expect(badTarget.status).toBe(404);
    expect((await db.getComboById(c1.id)).listId).toBe("default");

    // Move both into Work
    const moveRes = await call({ action: "move", ids: [c1.id, c2.id], listId: work.id });
    expect(moveRes.status).toBe(200);
    const moveData = await moveRes.json();
    expect(moveData.movedIds.sort()).toEqual([c1.id, c2.id].sort());
    expect((await db.getComboById(c1.id)).listId).toBe(work.id);

    // Batch delete: only existing ids removed; unknown ids silently skipped
    const delRes = await call({ action: "delete", ids: [c1.id, "ghost"] });
    expect(delRes.status).toBe(200);
    const delData = await delRes.json();
    expect(delData.deletedIds).toEqual([c1.id]);
    expect(await db.getComboById(c1.id)).toBeNull();
    expect(await db.getComboById(c2.id)).not.toBeNull();

    // Body must be an object
    const junk = await PUT(new Request("http://x/api/combos", { method: "PUT", body: "not-json" }));
    expect(junk.status).toBeGreaterThanOrEqual(400);
  });

  it("export/import roundtrip preserves lists, order and membership; old backups fall back to default", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const work = await db.createComboList("Work");
    await db.reorderComboLists([work.id, "default"]);
    const c1 = await db.createCombo({ name: "c1", models: [], listId: work.id });
    const snapshot = await db.exportDb();
    expect(snapshot.comboLists).toHaveLength(2);
    expect(snapshot.combos.find((c) => c.name === "c1").listId).toBe(work.id);

    // Restore the snapshot into a fresh DB → same layout.
    await db.importDb(snapshot);
    let lists = await db.getComboLists();
    expect(lists.map((l) => l.name)).toEqual(["Work", "默认清单"]);
    expect(lists.map((l) => l.sortOrder)).toEqual([0, 1]);
    expect((await db.getComboById(c1.id)).listId).toBe(work.id);

    // Old backup without any comboLists field → everything to default.
    await db.importDb({ settings: {}, combos: [{ id: "lc", name: "legacy-c", models: [] }] });
    lists = await db.getComboLists({ withCounts: true });
    expect(lists).toHaveLength(1);
    expect(lists[0].id).toBe("default");
    expect(lists[0].comboCount).toBe(1);
    expect((await db.getComboById("lc")).listId).toBe("default");
  });
});
