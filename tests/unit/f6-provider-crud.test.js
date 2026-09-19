// T1.5 §B2 + §B5 (task F6):
//  1. PUT /api/providers/[id] must answer 404 when the connection row
//     disappears inside the read-merge-write window (today the null returned
//     by updateProviderConnection is spread into `{}` → 200 {connection:{}}).
//  2. DELETE /api/provider-nodes/[id] must drop the node AND its connections
//     as ONE transaction (today the two writes are separate: a failure on the
//     second leaves the first already committed), and must WARN — naming the
//     combos still referencing "prefix/model" of the dead node — without
//     pruning them (rewriting saved combos behind the user's back is the
//     bigger surprise; the coordinated prune stays in /api/combos/remove-model).
//
// Real SQLite adapter (DATA_DIR tmp + initDb), same pattern as
// combo-remove-model.test.js. The race/failure windows are simulated by
// patching the adapter singleton's get/run for the duration of one call.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let PUT;
let NODE_DELETE;

const NODE_ID = "node-f6";

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-f6-provider-crud-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ PUT } = await import("@/app/api/providers/[id]/route.js"));
  ({ DELETE: NODE_DELETE } = await import("@/app/api/provider-nodes/[id]/route.js"));
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  for (const c of await db.getProviderConnections()) await db.deleteProviderConnection(c.id);
  for (const n of await db.getProviderNodes()) await db.deleteProviderNode(n.id);
  for (const c of await db.getCombos()) await db.deleteCombo(c.id);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const params = (id) => ({ params: Promise.resolve({ id }) });
const req = (body) => ({ json: async () => body });

async function seedNode(prefix = "myc") {
  return db.createProviderNode({
    id: NODE_ID,
    type: "openai-compatible",
    name: "F6 Node",
    prefix,
    apiType: "chat",
    baseUrl: "http://localhost:9/v1",
  });
}

function seedConnection(name) {
  return db.createProviderConnection({
    provider: NODE_ID,
    authType: "apikey",
    name,
    apiKey: "k",
  });
}

describe("PUT /api/providers/[id] — delete race inside the read-merge-write window", () => {
  it("returns 404 when the row disappears between the snapshot read and the write", async () => {
    const conn = await seedConnection("c1");

    const adapter = await db.getAdapter();
    const origGet = adapter.get;
    let connRowReads = 0;
    // getProviderConnectionById (route snapshot, read #1) and
    // updateProviderConnection (re-read inside its transaction, read #2)
    // share the SELECT — deny only the second one, i.e. the row was DELETEd
    // in the window between them.
    adapter.get = (sql, p) => {
      if (typeof sql === "string" && sql.includes("FROM providerConnections WHERE id = ?")) {
        connRowReads += 1;
        if (connRowReads >= 2) return undefined;
      }
      return origGet.call(adapter, sql, p);
    };
    let res;
    try {
      res = await PUT(req({ name: "renamed" }), params(conn.id));
    } finally {
      adapter.get = origGet;
    }

    expect(connRowReads).toBeGreaterThanOrEqual(2);
    // Today: `{...updated}` spreads null into `{}` → 200 {connection:{}}.
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Connection not found" });

    // the surviving row is untouched — the check is purely about the answer
    expect((await db.getProviderConnectionById(conn.id)).name).toBe("c1");
  });
});

describe("DELETE /api/provider-nodes/[id] — all-or-nothing node+connections", () => {
  it("rolls the connection wipe back when the node delete write fails", async () => {
    await seedNode();
    await seedConnection("c1");
    await seedConnection("c2");

    const adapter = await db.getAdapter();
    const origRun = adapter.run;
    adapter.run = (sql, p) => {
      if (typeof sql === "string" && sql.includes("DELETE FROM providerNodes")) {
        throw new Error("simulated second-write failure");
      }
      return origRun.call(adapter, sql, p);
    };
    let res;
    try {
      res = await NODE_DELETE({}, params(NODE_ID));
    } finally {
      adapter.run = origRun;
    }

    expect(res.status).toBe(500);
    // Today (RED): the connections DELETE is committed on its own, so we end
    // with a node WITHOUT its connections. After the fix nothing moved.
    expect(await db.getProviderNodeById(NODE_ID)).toBeTruthy();
    expect((await db.getProviderConnections({ provider: NODE_ID })).length).toBe(2);

    // a retry after the transient failure completes the deletion cleanly
    res = await NODE_DELETE({}, params(NODE_ID));
    expect(res.status).toBe(200);
    expect(await db.getProviderNodeById(NODE_ID)).toBeNull();
    expect(await db.getProviderConnections({ provider: NODE_ID })).toEqual([]);
  });
});

describe("DELETE /api/provider-nodes/[id] — orphaned-combo WARNING", () => {
  it("warns naming the combos that still reference the node prefix, and leaves them intact", async () => {
    await seedNode("myc");
    await seedConnection("c1");
    await db.createCombo({ name: "orphan-fast", models: ["myc/alpha", "other/beta"] });
    await db.createCombo({ name: "orphan-solo", models: ["myc/gamma"] });
    await db.createCombo({ name: "clean-combo", models: ["other/delta"] });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await NODE_DELETE({}, params(NODE_ID));

    expect(res.status).toBe(200);
    const warnings = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(warnings).toContain("orphan-fast");
    expect(warnings).toContain("orphan-solo");
    expect(warnings).not.toContain("clean-combo");

    // the deletion proceeds...
    expect(await db.getProviderNodeById(NODE_ID)).toBeNull();
    expect(await db.getProviderConnections({ provider: NODE_ID })).toEqual([]);
    // ...but the combos are NOT pruned — the user keeps their saved routing
    expect((await db.getComboByName("orphan-fast")).models).toEqual(["myc/alpha", "other/beta"]);
    expect((await db.getComboByName("orphan-solo")).models).toEqual(["myc/gamma"]);
  });

  it("deletes cleanly with no warning when no combo references the node", async () => {
    await seedNode("quietc");
    await seedConnection("c1");
    await db.createCombo({ name: "clean-combo", models: ["other/delta"] });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await NODE_DELETE({}, params(NODE_ID));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(await db.getProviderNodeById(NODE_ID)).toBeNull();
    expect(await db.getProviderConnections({ provider: NODE_ID })).toEqual([]);
    const warnings = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(warnings).not.toContain("quietc");
    expect((await db.getComboByName("clean-combo")).models).toEqual(["other/delta"]);
  });
});
