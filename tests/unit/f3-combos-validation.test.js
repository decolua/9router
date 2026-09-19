// F3 — combo CRUD validation (T1.5 M3 + B6).
//
// POST/PUT /api/combos accepted any JSON in `models`, any `kind`, and PUT
// skipped name validation for falsy values (""/0) while the repo spread still
// wrote them — orphaning the combo. The byName pre-check → INSERT was also
// non-transactional, so a double submit hit the UNIQUE index as a 500.
//
// Validation lives at the route layer on purpose: the repo is used by
// migrations and existing tests with shapes the HTTP API must not accept
// (e.g. createCombo({ kind: "fallback" })), so those keep working untouched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let POST, PUT_COMBO;
let POST_REMOVE, resetComboRotation, getRotatedModels;
let COMBO_KINDS_SOURCE;
let MEDIA_PROVIDER_KINDS;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-f3-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ POST } = await import("@/app/api/combos/route.js"));
  ({ PUT: PUT_COMBO } = await import("@/app/api/combos/[id]/route.js"));
  ({ POST: POST_REMOVE } = await import("@/app/api/combos/remove-model/route.js"));
  ({ resetComboRotation, getRotatedModels } = await import("open-sse/services/combo.js"));
  // Source of truth for kinds — the same constant the dashboard lists.
  ({ MEDIA_PROVIDER_KINDS } = await import("@/shared/constants/providers.js"));
  COMBO_KINDS_SOURCE = ["llm", ...MEDIA_PROVIDER_KINDS.map((k) => k.id)];
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  for (const combo of await db.getCombos()) await db.deleteCombo(combo.id);
  resetComboRotation();
});

const req = (body) => ({ json: async () => body });
const post = (body) => POST(req(body));
const put = (id, body) => PUT_COMBO(req(body), { params: Promise.resolve({ id }) });

describe("POST /api/combos — models", () => {
  it("rejects models given as a loose string", async () => {
    const res = await post({ name: "f3-str", models: "p/a" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(await db.getComboByName("f3-str")).toBeNull();
  });

  it("rejects models given as a loose object", async () => {
    const res = await post({ name: "f3-obj", models: { 0: "p/a" } });
    expect(res.status).toBe(400);
    expect(await db.getComboByName("f3-obj")).toBeNull();
  });

  it("rejects models given as a number", async () => {
    const res = await post({ name: "f3-num", models: 42 });
    expect(res.status).toBe(400);
    expect(await db.getComboByName("f3-num")).toBeNull();
  });

  it("rejects entries that are neither strings nor objects", async () => {
    const res = await post({ name: "f3-item", models: ["p/ok", 7] });
    expect(res.status).toBe(400);
    expect(await db.getComboByName("f3-item")).toBeNull();
  });

  it("accepts arrays of strings and of objects", async () => {
    const res = await post({ name: "f3-both", models: ["p/a", { model: "p/b" }] });
    expect(res.status).toBe(201);
    expect((await db.getComboByName("f3-both")).models).toEqual(["p/a", { model: "p/b" }]);
  });

  it("still defaults an absent models to []", async () => {
    const res = await post({ name: "f3-absent" });
    expect(res.status).toBe(201);
    expect((await db.getComboByName("f3-absent")).models).toEqual([]);
  });

  it("rejects a non-string name instead of coercing it into the key", async () => {
    const res = await post({ name: 123, models: ["p/a"] });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/combos — kind", () => {
  it("rejects a kind the runtime never reads", async () => {
    for (const kind of ["bogus", "", "fallback", 42, ["llm"]]) {
      const res = await post({ name: "f3-kind", kind });
      expect(res.status, `kind ${JSON.stringify(kind)}`).toBe(400);
    }
    expect(await db.getComboByName("f3-kind")).toBeNull();
  });

  it("accepts every kind the dashboard can create (llm + MEDIA_PROVIDER_KINDS)", async () => {
    let i = 0;
    for (const kind of COMBO_KINDS_SOURCE) {
      const res = await post({ name: `f3-k${i}`, kind });
      expect(res.status, `kind ${kind}`).toBe(201);
      expect((await db.getComboByName(`f3-k${i}`)).kind).toBe(kind);
      i += 1;
    }
  });

  it("accepts null and absent kind (default llm behaviour, unchanged)", async () => {
    expect((await post({ name: "f3-knull", kind: null })).status).toBe(201);
    expect((await post({ name: "f3-kabsent" })).status).toBe(201);
    expect((await db.getComboByName("f3-knull")).kind).toBeNull();
    expect((await db.getComboByName("f3-kabsent")).kind).toBeNull();
  });
});

describe("POST /api/combos — duplicate name race (TOCTOU)", () => {
  it("answers 400 (validation shape), not 500, when the pre-check loses the race", async () => {
    // Both requests pass the getComboByName pre-check before either INSERTs:
    // the SQLite driver is synchronous, so this interleaving is deterministic.
    const [a, b] = await Promise.all([post({ name: "f3-race", models: ["p/a"] }), post({ name: "f3-race", models: ["p/b"] })]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 400]); // one creates, the other is refused as duplicate — never a 500
    const dup = (await db.getCombos()).filter((c) => c.name === "f3-race");
    expect(dup).toHaveLength(1);
    const loser = a.status === 400 ? a : b;
    expect((await loser.json()).error).toBeTruthy();
  });

  it("plain duplicate submission is still 400 via the pre-check", async () => {
    expect((await post({ name: "f3-dup" })).status).toBe(201);
    expect((await post({ name: "f3-dup" })).status).toBe(400);
  });
});

describe("PUT /api/combos/[id] — name", () => {
  it("rejects an empty name instead of orphaning the combo", async () => {
    const combo = await db.createCombo({ name: "f3-empty", models: ["p/a"] });
    const res = await put(combo.id, { name: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect((await db.getComboById(combo.id)).name).toBe("f3-empty");
  });

  it("rejects a numeric name (falsy 0 skipped validation and was stored)", async () => {
    const combo = await db.createCombo({ name: "f3-zero", models: ["p/a"] });
    expect((await put(combo.id, { name: 0 })).status).toBe(400);
    expect((await db.getComboById(combo.id)).name).toBe("f3-zero");
    expect((await put(combo.id, { name: 7 })).status).toBe(400);
    expect((await db.getComboById(combo.id)).name).toBe("f3-zero");
  });

  it("still rejects invalid characters and duplicates (unchanged)", async () => {
    await db.createCombo({ name: "f3-other", models: [] });
    const combo = await db.createCombo({ name: "f3-keep", models: [] });
    expect((await put(combo.id, { name: "bad name!" })).status).toBe(400);
    expect((await put(combo.id, { name: "f3-other" })).status).toBe(400);
  });

  it("allows keeping the own name and renaming to a valid free one", async () => {
    const combo = await db.createCombo({ name: "f3-re", models: [] });
    expect((await put(combo.id, { name: "f3-re" })).status).toBe(200);
    expect((await put(combo.id, { name: "f3-re-2" })).status).toBe(200);
    expect((await db.getComboById(combo.id)).name).toBe("f3-re-2");
  });

  it("rejects a rename that loses the uniqueness race with 400, not 500", async () => {
    const comboA = await db.createCombo({ name: "f3-race-a", models: [] });
    const comboB = await db.createCombo({ name: "f3-race-b", models: [] });
    // Both renames pass their pre-check before either UPDATE lands.
    const [r1, r2] = await Promise.all([put(comboA.id, { name: "f3-race-merged" }), put(comboB.id, { name: "f3-race-merged" })]);
    expect([r1.status, r2.status].sort((x, y) => x - y)).toEqual([200, 400]);
    const names = (await db.getCombos()).map((c) => c.name);
    expect(names.filter((n) => n === "f3-race-merged")).toHaveLength(1);
  });
});

describe("PUT /api/combos/[id] — kind and models", () => {
  it("rejects an invalid kind when the key is present and stores nothing", async () => {
    const combo = await db.createCombo({ name: "f3-pk", models: [], kind: "llm" });
    for (const kind of ["bogus", "", 42]) {
      expect((await put(combo.id, { kind })).status).toBe(400);
    }
    expect((await db.getComboById(combo.id)).kind).toBe("llm");
  });

  it("accepts a valid kind and an explicit null (clear)", async () => {
    const combo = await db.createCombo({ name: "f3-pk2", models: [] });
    expect((await put(combo.id, { kind: "image" })).status).toBe(200);
    expect((await db.getComboById(combo.id)).kind).toBe("image");
    expect((await put(combo.id, { kind: null })).status).toBe(200);
    expect((await db.getComboById(combo.id)).kind).toBeNull();
  });

  it("rejects non-array models on update, leaving the stored list intact", async () => {
    const combo = await db.createCombo({ name: "f3-pm", models: ["p/a", "p/b"] });
    expect((await put(combo.id, { models: "p/c" })).status).toBe(400);
    expect((await put(combo.id, { models: { 0: "p/c" } })).status).toBe(400);
    expect((await put(combo.id, { models: ["p/c", null] })).status).toBe(400);
    expect((await db.getComboById(combo.id)).models).toEqual(["p/a", "p/b"]);
    expect((await put(combo.id, { models: ["p/c"] })).status).toBe(200);
    expect((await db.getComboById(combo.id)).models).toEqual(["p/c"]);
  });
});

describe("POST /api/combos/remove-model — rotation reset (B6)", () => {
  it("resets round-robin state for the combos it pruned", async () => {
    await db.createCombo({ name: "f3-rot", models: ["p/a", "p/b", "p/c", "p/d"] });
    // Two round-robin calls advance the index to 2 (heads p/a, p/b).
    expect(getRotatedModels(["p/a", "p/b", "p/c", "p/d"], "f3-rot", "round-robin")[0]).toBe("p/a");
    expect(getRotatedModels(["p/a", "p/b", "p/c", "p/d"], "f3-rot", "round-robin")[0]).toBe("p/b");

    const res = await POST_REMOVE(req({ candidates: ["p/a"] }));
    expect(res.status).toBe(200);

    // Without a reset the stale index 2 would surface "p/d" next; a reset —
    // consistent with PUT/DELETE /api/combos/[id] — restarts the pruned list.
    expect(getRotatedModels(["p/b", "p/c", "p/d"], "f3-rot", "round-robin")[0]).toBe("p/b");
  });
});

describe("repo contract unchanged (no caller breakage)", () => {
  it("createCombo/updateCombo still accept shapes the HTTP layer now rejects", async () => {
    // db-sqlite-vs-lowdb.test.js writes kind "fallback" straight through the repo.
    const combo = await db.createCombo({ name: "f3-repo", models: ["m1", "m2"], kind: "fallback" });
    expect(combo.kind).toBe("fallback");
    expect((await db.updateCombo(combo.id, { models: ["m3"] })).models).toEqual(["m3"]);
  });
});
