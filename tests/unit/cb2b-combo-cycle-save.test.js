// CB2b — reject cyclic combo references at SAVE time (follow-up of CB2 0bfe5142).
//
// CB2 added the runtime chain-guard (chat.js comboPath → deterministic 400 on a
// cycle mid-request) because a self-referencing (c1:[c1]) or cyclic (A→B→A)
// combo used to recurse handleComboChat until the heap died. The guard stops
// the crash, but the invalid data can still be saved. This test pins the
// save-side policy: POST/PUT /api/combos must 400 whenever the combo as it
// WOULD be stored takes part in a combo→combo cycle (self-reference is just the
// 1-node case). "combo→combo edge" mirrors the runtime: a member references
// another combo when its first "/"-separated token equals a known combo name —
// bare "c1" is the real recursion form (getComboModels refuses slashed names,
// so a cycle can only close through bare members); "c1/anything" is ambiguous
// member data and is treated as a potential edge.
//
// Scope rules proved here:
//  - Only the SAVED combo may be rejected: a pre-existing legacy cycle between
//    A and B must not make an unrelated combo's save fail (no forced migration).
//  - A PUT that breaks the cycle (rename or members change) is accepted.
//  - GET is never blocked — read endpoints must keep serving legacy rows.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let GET_ALL, POST, PUT_COMBO;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-cb2b-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ GET: GET_ALL, POST } = await import("@/app/api/combos/route.js"));
  ({ PUT: PUT_COMBO } = await import("@/app/api/combos/[id]/route.js"));
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  for (const combo of await db.getCombos()) await db.deleteCombo(combo.id);
});

const req = (body) => ({ json: async () => body });
const post = (body) => POST(req(body));
const put = (id, body) => PUT_COMBO(req(body), { params: Promise.resolve({ id }) });
const errOf = async (res) => (await res.json()).error || "";

describe("self-reference", () => {
  it("POST rejects a combo containing itself and stores nothing", async () => {
    const res = await post({ name: "c1", models: ["c1"] });
    expect(res.status).toBe(400);
    const err = await errOf(res);
    expect(err).toMatch(/self-reference/i);
    expect(err).toContain("c1");
    expect(await db.getComboByName("c1")).toBeNull();
  });

  it("POST rejects a self-reference written as c1/<anything>", async () => {
    const res = await post({ name: "c1", models: ["openai/gpt-4o", "c1/whatever"] });
    expect(res.status).toBe(400);
    expect(await errOf(res)).toMatch(/self-reference/i);
    expect(await db.getComboByName("c1")).toBeNull();
  });

  it("POST rejects a self-reference hidden in an object member", async () => {
    const res = await post({ name: "c1", models: [{ model: "c1" }] });
    expect(res.status).toBe(400);
    expect(await errOf(res)).toMatch(/self-reference/i);
  });

  it("PUT rejects adding itself to an existing combo and leaves the row untouched", async () => {
    const created = await post({ name: "c1", models: ["openai/gpt-4o"] });
    expect(created.status).toBe(201);
    const combo = await created.json();

    const res = await put(combo.id, { models: ["c1"] });
    expect(res.status).toBe(400);
    expect(await errOf(res)).toMatch(/cycle|self-reference/i);

    const stored = await db.getComboById(combo.id);
    expect(stored.models).toEqual(["openai/gpt-4o"]);
  });
});

describe("A → B → A (2-cycle)", () => {
  it("accepts the first save when it does not close a cycle", async () => {
    const b = await post({ name: "b", models: ["openai/gpt-4o"] });
    expect(b.status).toBe(201);
    const a = await post({ name: "a", models: ["b"] });
    expect(a.status).toBe(201);
  });

  it("rejects the save that closes the cycle, naming both combos", async () => {
    const b = await post({ name: "b", models: ["openai/gpt-4o"] });
    await post({ name: "a", models: ["b"] });

    const res = await put((await b.json()).id, { models: ["a"] });
    expect(res.status).toBe(400);
    const err = await errOf(res);
    expect(err).toMatch(/cycle/i);
    expect(err).toContain("b");
    expect(err).toContain("a");

    const stored = await db.getComboByName("b");
    expect(stored.models).toEqual(["openai/gpt-4o"]);
  });
});

describe("3-node cycle", () => {
  it("rejects the third save that closes a → b → c → a", async () => {
    // First two saves do NOT close a cycle (c does not exist yet — "c" would be
    // a dangling member, a → b is just a forward edge).
    expect((await post({ name: "a", models: ["b"] })).status).toBe(201);
    expect((await post({ name: "b", models: ["c"] })).status).toBe(201);

    const res = await post({ name: "c", models: ["a"] });
    expect(res.status).toBe(400);
    const err = await errOf(res);
    expect(err).toMatch(/cycle/i);
    expect(err).toContain("a");
    expect(err).toContain("b");
    expect(err).toContain("c");
    expect(await db.getComboByName("c")).toBeNull();
  });

  it("DFS goes deeper than one level: closing x → a → b → x on b's save is rejected", async () => {
    // a → b while b is a dangling name: no combo named b yet, no cycle possible.
    expect((await post({ name: "a", models: ["b"] })).status).toBe(201);
    expect((await post({ name: "x", models: ["a", "openai/gpt-4o"] })).status).toBe(201);

    // Saving b with ["x"] closes the 3-cycle x → a → b → x through b itself.
    // A one-level (potential-cycle) check would wave this through.
    const b = await post({ name: "b", models: ["x"] });
    expect(b.status).toBe(400);
    const err = await errOf(b);
    expect(err).toMatch(/cycle/i);
    expect(err).toContain("b");
    expect(err).toContain("x");
    expect(await db.getComboByName("b")).toBeNull();
  });
});

describe("legitimate combos are untouched", () => {
  it("accepts real provider members, strings and objects", async () => {
    const res = await post({
      name: "fast",
      models: ["openai/gpt-4o", "anthropic/claude-sonnet-4", { model: "google/gemini-2.5-pro" }],
    });
    expect(res.status).toBe(201);
  });

  it("accepts a member that merely LOOKS like a name with no combo behind it", async () => {
    // "ghost" is not a saved combo → bare member is a dangling/alias name, not an edge.
    const res = await post({ name: "solo", models: ["ghost", "ghost/deep"] });
    expect(res.status).toBe(201);
  });

  it("accepts diamond-shaped nesting (two combos referencing the same leaf)", async () => {
    expect((await post({ name: "leaf", models: ["openai/gpt-4o"] })).status).toBe(201);
    expect((await post({ name: "l", models: ["leaf"] })).status).toBe(201);
    expect((await post({ name: "r", models: ["leaf"] })).status).toBe(201);
    const res = await post({ name: "top", models: ["l", "r"] });
    expect(res.status).toBe(201);
  });
});

describe("no forced migration: only the saved combo's own cycles block its save", () => {
  // Legacy rows from before CB2b — inserted through the repo, bypassing routes,
  // exactly the state the runtime guard of CB2 was written to survive.
  const seedLegacyCycle = async () => {
    await db.createCombo({ name: "lA", models: ["lB"], kind: null });
    await db.createCombo({ name: "lB", models: ["lA"], kind: null });
  };

  it("GET /api/combos still lists a legacy cycle (read path unaffected)", async () => {
    await seedLegacyCycle();
    const res = await GET_ALL();
    expect(res.status).toBe(200);
    const { combos } = await res.json();
    expect(combos.map((c) => c.name).sort()).toEqual(["lA", "lB"]);
  });

  it("saving an UNRELATED combo succeeds while the legacy cycle exists", async () => {
    await seedLegacyCycle();
    const res = await post({ name: "ok", models: ["openai/gpt-4o", "lA"] });
    // lA is on a cycle, but the cycle does not pass through "ok" (ok → lA → lB → lA…
    // never returns to ok). Rejecting this would force the user to migrate lA/lB
    // first — explicitly out of policy. The runtime chain-guard covers it.
    expect(res.status).toBe(201);
  });

  it("PUT of a combo NOT on the cycle succeeds", async () => {
    await seedLegacyCycle();
    const ok = await post({ name: "ok", models: ["openai/gpt-4o"] });
    const res = await put((await ok.json()).id, { models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"] });
    expect(res.status).toBe(200);
  });

  it("a save of lB that BREAKS the cycle (rename) is accepted", async () => {
    await seedLegacyCycle();
    const lb = await db.getComboByName("lB");
    const res = await put(lb.id, { name: "lB2" });
    expect(res.status).toBe(200);
    // lA still contains "lB" — now dangling (the combo is lB2) — so no cycle:
    // lB2 → lA → (lB is gone).
    const stored = await db.getComboById(lb.id);
    expect(stored.name).toBe("lB2");
  });

  it("a save of lB that BREAKS the cycle (member swap) is accepted", async () => {
    await seedLegacyCycle();
    const lb = await db.getComboByName("lB");
    const res = await put(lb.id, { models: ["openai/gpt-4o"] });
    expect(res.status).toBe(200);
    expect((await db.getComboById(lb.id)).models).toEqual(["openai/gpt-4o"]);
  });

  it("re-saving lB unchanged is rejected — the saved combo may not sit on a cycle", async () => {
    await seedLegacyCycle();
    const lb = await db.getComboByName("lB");
    const res = await put(lb.id, { kind: "llm" });
    expect(res.status).toBe(400);
    expect(await errOf(res)).toMatch(/cycle/i);
    // Recoverable: DELETE (never validated, it removes data) + recreate works.
    const { DELETE } = await import("@/app/api/combos/[id]/route.js");
    const del = await DELETE(req({}), { params: Promise.resolve({ id: lb.id }) });
    expect(del.status).toBe(200);
    expect((await post({ name: "lB", models: ["openai/gpt-4o"] })).status).toBe(201);
  });
});
