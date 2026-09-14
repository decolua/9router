// FED-002 — replication service + routes tests.
//
// Covers (gitreins fed-002 criteria):
//  - snapshot shape + version columns (exportDb() shape + federation_version/
//    updated_at/deleted on every row)
//  - delta since=N filtering + tombstones + max_version watermark + schemaVersion
//  - edge apply transactional per revision batch + idempotent (double-apply no-op)
//  - SCHEMA_BLOCKED on unknown (newer) migration version — nothing applied
//  - write-path stamping: repo writes bump federation_version, deletes become
//    tombstones (deleted=1), usage tables never stamped
//  - standalone mode → edgeClient.start() refuses (zero drift)
//  - central route handlers: role gating (standalone → 403), payload shapes
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { REPLICATE_TABLES, REPLICATE_TABLES_PHYSICAL } from "@/lib/federation/constants.js";
import { latestVersion } from "@/lib/db/migrations/index.js";

const FED_ENV_KEYS = [
  "FEDERATION_MODE",
  "FEDERATION_CENTRAL_URL",
  "FEDERATION_EDGE_ID",
  "FEDERATION_SYNC_INTERVAL_MS",
  "FEDERATION_TOKEN",
];

let tempDir;
let savedEnv = {};
let savedDataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-repl-"));
  for (const k of FED_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir; // safety net: any accidental real init stays in temp
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  for (const k of FED_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
});

// Point the DB driver at a specific adapter. driver.js captures `state` (the
// global._dbAdapter object) at module load, so we MUTATE the object in place
// rather than replacing it — a replaced object would be invisible to an
// already-imported driver module.
function pointDriverAt(db) {
  if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
  global._dbAdapter.instance = db;
  global._dbAdapter.initPromise = Promise.resolve(db);
  global._dbAdapter.logged = true;
}

// ─── Harness: fresh migrated DB on a given adapter ──────────────────────
async function loadAdapterFactories() {
  const factories = [];
  try {
    const mod = await import("@/lib/db/adapters/betterSqliteAdapter.js");
    factories.push({ name: "better-sqlite3", create: (file) => mod.createBetterSqliteAdapter(file) });
  } catch (e) {
    console.warn(`[test] better-sqlite3 unavailable: ${e.message}`);
  }
  try {
    const mod = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    factories.push({ name: "node:sqlite", create: async (file) => mod.createNodeSqliteAdapter(file) });
  } catch (e) {
    console.warn(`[test] node:sqlite unavailable: ${e.message}`);
  }
  try {
    const mod = await import("@/lib/db/adapters/sqljsAdapter.js");
    factories.push({ name: "sql.js", create: async (file) => mod.createSqlJsAdapter(file) });
  } catch (e) {
    console.warn(`[test] sql.js unavailable: ${e.message}`);
  }
  return factories;
}

let _dbSeq = 0;

async function createMigratedDb(factoryName = "better-sqlite3") {
  const factories = await loadAdapterFactories();
  const factory = factories.find((f) => f.name === factoryName) || factories[0];
  const file = path.join(tempDir, `${factory.name.replace(":", "-")}-${++_dbSeq}.sqlite`);
  const db = await factory.create(file);
  const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
  const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");
  const { default: m003 } = await import("@/lib/db/migrations/003-federation-state.js");
  const { default: m004 } = await import("@/lib/db/migrations/004-federation-fencing.js");
  m001.up(db);
  m002.up(db);
  m003.up(db);
  m004.up(db);
  return db;
}

// Seed a central DB with stamped rows via the real repos (exercises the
// write-path hooks at the same time). IMPORTANT: global._dbAdapter must be
// set BEFORE the first driver.js import in the test — driver.js captures
// `state` at module load, so a late assignment is invisible to getAdapter().
async function seedCentral(db) {
  pointDriverAt(db);
  const { getAdapter } = await import("@/lib/db/driver.js");
  const dbApi = await import("@/lib/db/index.js");

  const conn = await dbApi.createProviderConnection({ provider: "openai", authType: "apikey", name: "main", apiKey: "sk-test" });
  const node = await dbApi.createProviderNode({ type: "openai", name: "n1", baseUrl: "https://api.openai.com", apiType: "openai" });
  const pool = await dbApi.createProxyPool({ name: "p1", proxyUrl: "http://proxy:8080", type: "http" });
  const key = await dbApi.createApiKey("k1", "machine-1");
  const combo = await dbApi.createCombo({ name: "c1", models: ["m1"], kind: "fallback" });
  await dbApi.setModelAlias("alias1", "real-model-1");
  await dbApi.updatePricing({ openai: { "gpt-test": { input: 1, output: 2 } } });
  await dbApi.updateSettings({ cloudEnabled: true });

  return { dbApi, ids: { conn: conn.id, node: node.id, pool: pool.id, key: key.id, combo: combo.id } };
}

// ─── Snapshot ───────────────────────────────────────────────────────────

describe("snapshot (buildSnapshot)", () => {
  it("returns all 8 logical tables in exportDb() shape with version columns", async () => {
    const db = await createMigratedDb();
    const { dbApi } = await seedCentral(db);
    const { buildSnapshot } = await import("@/lib/federation/replication.js");

    const snap = buildSnapshot(db);

    expect(snap.schemaVersion).toBe(latestVersion());
    expect(snap.maxVersion).toBeGreaterThan(0);
    expect(Object.keys(snap.tables).sort()).toEqual([...REPLICATE_TABLES].sort());

    // providerConnections row: exportDb shape + version columns
    const conns = snap.tables.providerConnections;
    expect(conns.length).toBe(1);
    const c = conns[0];
    expect(c.row.provider).toBe("openai");
    expect(c.row.authType).toBe("apikey");
    expect(c.row.isActive).toBe(true);
    expect(c.federation_version).toBeGreaterThan(0);
    expect(typeof c.updated_at).toBe("string");
    expect(c.deleted).toBe(0);

    // kv-backed logical tables
    expect(snap.tables.modelAliases[0].row.key).toBe("alias1");
    expect(snap.tables.modelAliases[0].row.value).toBe("real-model-1");
    expect(snap.tables.pricing[0].row.key).toBe("openai");
    expect(snap.tables.pricing[0].row.value["gpt-test"]).toEqual({ input: 1, output: 2 });

    // settings single row
    expect(snap.tables.settings.length).toBe(1);
    expect(snap.tables.settings[0].row.data.cloudEnabled).toBe(true);

    // apiKeys/combo shapes
    expect(snap.tables.apiKeys[0].row.key).toMatch(/^sk-/);
    expect(snap.tables.combos[0].row.models).toEqual(["m1"]);
    expect(snap.tables.providerNodes[0].row.baseUrl).toBe("https://api.openai.com");
    expect(snap.tables.proxyPools[0].row.proxyUrl).toBe("http://proxy:8080");
  });

  it("excludes tombstoned rows (deleted=1) from the snapshot", async () => {
    const db = await createMigratedDb();
    const { dbApi, ids } = await seedCentral(db);
    const { buildSnapshot } = await import("@/lib/federation/replication.js");

    await dbApi.deleteProviderConnection(ids.conn);
    const snap = buildSnapshot(db);
    expect(snap.tables.providerConnections).toHaveLength(0);
  });
});

// ─── Delta ──────────────────────────────────────────────────────────────

describe("delta (buildDelta)", () => {
  it("returns only rows with federation_version > since, plus watermark + schemaVersion", async () => {
    const db = await createMigratedDb();
    const { dbApi, ids } = await seedCentral(db);
    const { buildDelta, computeWatermark } = await import("@/lib/federation/replication.js");

    const wm = computeWatermark(db);
    const delta0 = buildDelta(db, 0);
    expect(delta0.since).toBe(0);
    expect(delta0.maxVersion).toBe(wm);
    expect(delta0.schemaVersion).toBe(latestVersion());
    // Full delta at since=0 carries every live row
    expect(delta0.rows.length).toBeGreaterThanOrEqual(7); // 6 physical + kv rows
    expect(delta0.tombstones).toEqual([]);

    // Advance one row past the watermark
    await dbApi.updateProviderConnection(ids.conn, { name: "renamed" });
    const wm2 = computeWatermark(db);
    expect(wm2).toBeGreaterThan(wm);

    const deltaN = buildDelta(db, wm);
    expect(deltaN.maxVersion).toBe(wm2);
    // Only the updated connection row
    expect(deltaN.rows).toHaveLength(1);
    expect(deltaN.rows[0].table).toBe("providerConnections");
    expect(deltaN.rows[0].row.name).toBe("renamed");
    expect(deltaN.rows[0].federation_version).toBe(wm2);
    expect(deltaN.tombstones).toEqual([]);

    // since beyond watermark → empty
    const deltaFar = buildDelta(db, wm2);
    expect(deltaFar.rows).toEqual([]);
    expect(deltaFar.tombstones).toEqual([]);
    expect(deltaFar.maxVersion).toBe(wm2);
  });

  it("includes tombstones for deleted rows with federation_version > since", async () => {
    const db = await createMigratedDb();
    const { dbApi, ids } = await seedCentral(db);
    const { buildDelta, computeWatermark } = await import("@/lib/federation/replication.js");

    const wm = computeWatermark(db);
    await dbApi.deleteProviderConnection(ids.conn);
    const wm2 = computeWatermark(db);

    const delta = buildDelta(db, wm);
    expect(delta.tombstones).toHaveLength(1);
    expect(delta.tombstones[0].table).toBe("providerConnections");
    expect(delta.tombstones[0].key).toBe(ids.conn);
    expect(delta.rows).toEqual([]);
    expect(delta.maxVersion).toBe(wm2);
  });

  it("kv deletes surface as tombstones keyed scope|key", async () => {
    const db = await createMigratedDb();
    const { dbApi } = await seedCentral(db);
    const { buildDelta } = await import("@/lib/federation/replication.js");

    // Use the alias row's OWN version as `since` (the global watermark may be
    // higher from other tables' writes; the tombstone lands at rowVersion+1).
    const rowVersion = db.get(`SELECT federation_version FROM kv WHERE scope='modelAliases' AND key='alias1'`).federation_version;
    await dbApi.deleteModelAlias("alias1");
    const delta = buildDelta(db, rowVersion);
    expect(delta.tombstones).toHaveLength(1);
    // Tombstones carry the LOGICAL table name (apply maps it to kv rows)
    expect(delta.tombstones[0].table).toBe("modelAliases");
    expect(delta.tombstones[0].key).toBe("modelAliases|alias1");
  });
});

// ─── Edge apply ─────────────────────────────────────────────────────────

describe("edge apply (applyRevisionBatch)", () => {
  it("applies a snapshot transactionally and advances lastAppliedRevision", async () => {
    const central = await createMigratedDb();
    const { buildSnapshot } = await import("@/lib/federation/replication.js");
    await seedCentral(central);
    const snap = buildSnapshot(central);

    const edge = await createMigratedDb();
    const { applyRevisionBatch, readLastAppliedRevision } = await import("@/lib/federation/replication.js");

    const result = applyRevisionBatch(edge, snap);
    expect(result.applied).toBe(true);
    expect(result.lastAppliedRevision).toBe(snap.maxVersion);
    expect(readLastAppliedRevision(edge)).toBe(snap.maxVersion);

    // Edge replica now mirrors central
    expect(edge.get(`SELECT provider FROM providerConnections`).provider).toBe("openai");
    expect(edge.get(`SELECT value FROM kv WHERE scope='modelAliases' AND key='alias1'`)).not.toBeNull();
    expect(edge.get(`SELECT data FROM settings WHERE id=1`)).not.toBeNull();
    // Versions preserved exactly
    const centralRow = central.get(`SELECT federation_version FROM providerConnections`);
    const edgeRow = edge.get(`SELECT federation_version FROM providerConnections`);
    expect(edgeRow.federation_version).toBe(centralRow.federation_version);
  });

  it("re-applying the same batch is a no-op (idempotent)", async () => {
    const central = await createMigratedDb();
    const { buildSnapshot } = await import("@/lib/federation/replication.js");
    await seedCentral(central);
    const snap = buildSnapshot(central);

    const edge = await createMigratedDb();
    const { applyRevisionBatch, readLastAppliedRevision } = await import("@/lib/federation/replication.js");

    const first = applyRevisionBatch(edge, snap);
    expect(first.applied).toBe(true);

    // Double-apply: no-op, revision unchanged, data unchanged
    const second = applyRevisionBatch(edge, snap);
    expect(second.applied).toBe(false);
    expect(second.lastAppliedRevision).toBe(snap.maxVersion);
    expect(readLastAppliedRevision(edge)).toBe(snap.maxVersion);
    expect(edge.get(`SELECT COUNT(*) AS c FROM providerConnections`).c).toBe(1);
  });

  it("applies deltas incrementally and handles tombstones", async () => {
    const central = await createMigratedDb();
    const { buildSnapshot, buildDelta, computeWatermark } = await import("@/lib/federation/replication.js");
    const { dbApi, ids } = await seedCentral(central);
    const snap = buildSnapshot(central);

    const edge = await createMigratedDb();
    const { applyRevisionBatch } = await import("@/lib/federation/replication.js");
    applyRevisionBatch(edge, snap);

    // Central: update a row + delete another + add a new one
    await dbApi.updateProviderConnection(ids.conn, { name: "renamed" });
    await dbApi.deleteProviderNode(ids.node);
    const extra = await dbApi.createCombo({ name: "c2", models: ["m9"], kind: "fallback" });

    const wm = computeWatermark(central);
    const delta = buildDelta(central, snap.maxVersion);
    const res = applyRevisionBatch(edge, delta);
    expect(res.applied).toBe(true);
    expect(res.lastAppliedRevision).toBe(wm);

    // Edge reflects: renamed conn, tombstoned node gone from logical reads,
    // new combo present
    expect(edge.get(`SELECT name FROM providerConnections`).name).toBe("renamed");
    expect(edge.get(`SELECT COUNT(*) AS c FROM providerNodes WHERE deleted=0`).c).toBe(0);
    expect(edge.get(`SELECT COUNT(*) AS c FROM combos WHERE name='c2'`).c).toBe(1);
    expect(edge.get(`SELECT deleted FROM combos WHERE id=?`, [extra.id]).deleted).toBe(0);
  });

  it("is transactional: a failing batch leaves the edge untouched", async () => {
    const central = await createMigratedDb();
    const { buildSnapshot } = await import("@/lib/federation/replication.js");
    await seedCentral(central);
    const snap = buildSnapshot(central);

    const edge = await createMigratedDb();
    const { applyRevisionBatch, readLastAppliedRevision } = await import("@/lib/federation/replication.js");

    // Corrupt the payload: an unknown table makes the apply throw mid-batch
    const bad = {
      ...snap,
      tables: { ...snap.tables, bogusTable: [{ row: { id: "x" }, federation_version: 1, updated_at: null, deleted: 0 }] },
    };
    expect(() => applyRevisionBatch(edge, bad)).toThrow(/unknown replicated table/);
    // Nothing applied, revision untouched
    expect(readLastAppliedRevision(edge)).toBe(0);
    expect(edge.get(`SELECT COUNT(*) AS c FROM providerConnections`).c).toBe(0);
  });

  it("SCHEMA_BLOCKED: newer central schemaVersion blocks apply, nothing applied, resumable", async () => {
    const central = await createMigratedDb();
    const { buildSnapshot } = await import("@/lib/federation/replication.js");
    await seedCentral(central);
    const snap = buildSnapshot(central);

    const edge = await createMigratedDb();
    const { applyRevisionBatch, readLastAppliedRevision, SchemaBlockedError } = await import("@/lib/federation/replication.js");

    // Simulate a future central (schemaVersion 999) — edge is at latestVersion()
    const future = { ...snap, schemaVersion: 999 };
    expect(() => applyRevisionBatch(edge, future)).toThrow(SchemaBlockedError);
    try {
      applyRevisionBatch(edge, future);
    } catch (err) {
      expect(err.code).toBe("SCHEMA_BLOCKED");
      expect(err.edgeVersion).toBe(latestVersion());
      expect(err.centralVersion).toBe(999);
    }
    // Nothing applied, revision untouched
    expect(readLastAppliedRevision(edge)).toBe(0);
    expect(edge.get(`SELECT COUNT(*) AS c FROM providerConnections`).c).toBe(0);

    // After the edge "upgrades" (schemaVersion now matches), the SAME batch applies
    const ok = applyRevisionBatch(edge, snap);
    expect(ok.applied).toBe(true);
    expect(edge.get(`SELECT COUNT(*) AS c FROM providerConnections`).c).toBe(1);
  });

  it("works on every available adapter (better-sqlite3, node:sqlite, sql.js)", async () => {
    const factories = await loadAdapterFactories();
    const { buildSnapshot } = await import("@/lib/federation/replication.js");
    const { applyRevisionBatch } = await import("@/lib/federation/replication.js");

    const central = await createMigratedDb();
    await seedCentral(central);
    const snap = buildSnapshot(central);

    for (const factory of factories) {
      const file = path.join(tempDir, `edge-${factory.name.replace(":", "-")}.sqlite`);
      const edge = await factory.create(file);
      const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
      const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");
      m001.up(edge);
      m002.up(edge);

      const first = applyRevisionBatch(edge, snap);
      expect(first.applied).toBe(true);
      const second = applyRevisionBatch(edge, snap);
      expect(second.applied).toBe(false);
      expect(edge.get(`SELECT COUNT(*) AS c FROM providerConnections`).c).toBe(1);
      edge.close?.();
    }
  });
});

// ─── Write-path stamping ────────────────────────────────────────────────

describe("write-path stamping hooks", () => {
  it("INSERT stamps federation_version + updated_at; UPDATE increments", async () => {
    const db = await createMigratedDb();
    const { dbApi, ids } = await seedCentral(db);

    // Versions are watermark-based (global max + 1), so exact numbers depend
    // on write order — assert the invariants: stamped, monotonic, not deleted.
    const row = db.get(`SELECT federation_version, updated_at, deleted FROM providerConnections WHERE id = ?`, [ids.conn]);
    expect(row.federation_version).toBeGreaterThan(0);
    expect(typeof row.updated_at).toBe("string");
    expect(row.deleted).toBe(0);

    await dbApi.updateProviderConnection(ids.conn, { name: "v2" });
    const row2 = db.get(`SELECT federation_version FROM providerConnections WHERE id = ?`, [ids.conn]);
    expect(row2.federation_version).toBeGreaterThan(row.federation_version);
  });

  it("DELETE becomes a tombstone (deleted=1, version bumped), logical reads hide it", async () => {
    const db = await createMigratedDb();
    const { dbApi, ids } = await seedCentral(db);

    const before = db.get(`SELECT federation_version FROM providerConnections WHERE id = ?`, [ids.conn]).federation_version;
    const ok = await dbApi.deleteProviderConnection(ids.conn);
    expect(ok).toBe(true);

    const row = db.get(`SELECT deleted, federation_version FROM providerConnections WHERE id = ?`, [ids.conn]);
    expect(row.deleted).toBe(1);
    expect(row.federation_version).toBeGreaterThan(before);

    // Logical reads hide the tombstone
    expect(await dbApi.getProviderConnectionById(ids.conn)).toBeNull();
    expect(await dbApi.getProviderConnections()).toHaveLength(0);
  });

  it("stamps every replicated table (settings, nodes, pools, keys, combos, kv)", async () => {
    const db = await createMigratedDb();
    const { dbApi, ids } = await seedCentral(db);

    const checks = [
      ["settings", `SELECT federation_version FROM settings WHERE id=1`],
      ["providerNodes", `SELECT federation_version FROM providerNodes WHERE id='${ids.node}'`],
      ["proxyPools", `SELECT federation_version FROM proxyPools WHERE id='${ids.pool}'`],
      ["apiKeys", `SELECT federation_version FROM apiKeys WHERE id='${ids.key}'`],
      ["combos", `SELECT federation_version FROM combos WHERE id='${ids.combo}'`],
      ["kv", `SELECT federation_version FROM kv WHERE scope='modelAliases' AND key='alias1'`],
      ["kv", `SELECT federation_version FROM kv WHERE scope='pricing' AND key='openai'`],
    ];
    for (const [table, sql] of checks) {
      const row = db.get(sql);
      expect(row.federation_version).toBeGreaterThan(0);
    }

    // kv delete → tombstone (version strictly greater than the row's own)
    const aliasVersion = db.get(`SELECT federation_version FROM kv WHERE scope='modelAliases' AND key='alias1'`).federation_version;
    await dbApi.deleteModelAlias("alias1");
    const kvRow = db.get(`SELECT deleted, federation_version FROM kv WHERE scope='modelAliases' AND key='alias1'`);
    expect(kvRow.deleted).toBe(1);
    expect(kvRow.federation_version).toBeGreaterThan(aliasVersion);
    expect((await dbApi.getModelAliases()).alias1).toBeUndefined();
  });

  it("usage tables are NEVER stamped", async () => {
    const db = await createMigratedDb();
    const { dbApi } = await seedCentral(db);
    await dbApi.saveRequestUsage({
      provider: "openai",
      model: "gpt-test",
      connectionId: "c1",
      tokens: { prompt_tokens: 5, completion_tokens: 5 },
      cost: 0.01,
      status: "ok",
    });
    const cols = db.all(`PRAGMA table_info(usageHistory)`).map((c) => c.name);
    expect(cols).not.toContain("federation_version");
    expect(cols).not.toContain("deleted");
  });

  it("exportDb() includes version columns and excludes tombstones (additive)", async () => {
    const db = await createMigratedDb();
    const { dbApi, ids } = await seedCentral(db);
    await dbApi.deleteProviderConnection(ids.conn);

    const exported = await dbApi.exportDb();
    expect(exported.providerConnections).toHaveLength(0);
    expect(exported.combos[0].federation_version).toBeGreaterThan(0);
    expect(exported.combos[0].deleted).toBe(0);
    expect(exported.modelAliases.alias1).toBe("real-model-1");
  });
});

// ─── Central route handlers (server.js) ────────────────────────────────

describe("central route handlers (server.js)", () => {
  it("standalone mode → 403 on snapshot/delta/verify (zero drift)", async () => {
    delete process.env.FEDERATION_MODE;
    vi.resetModules();
    const { handleSnapshot, handleDelta, handleVerify, HttpError } = await import("@/lib/federation/server.js");
    for (const fn of [handleSnapshot, handleDelta, handleVerify]) {
      try {
        await fn({ nextUrl: { searchParams: new URLSearchParams() } });
        expect.unreachable("expected HttpError 403");
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect(err.status).toBe(403);
      }
    }
  });

  it("central mode → snapshot/delta/verify/status return payloads", async () => {
    process.env.FEDERATION_MODE = "central";
    vi.resetModules();
    const db = await createMigratedDb();
    pointDriverAt(db);
    const { dbApi } = await seedCentral(db);

    const { handleSnapshot, handleDelta, handleVerify, handleStatus } = await import("@/lib/federation/server.js");
    const { computeWatermark } = await import("@/lib/federation/replication.js");

    const snap = await handleSnapshot({ nextUrl: { searchParams: new URLSearchParams("since=0") } });
    expect(snap.schemaVersion).toBe(latestVersion());
    expect(snap.tables.providerConnections).toHaveLength(1);
    expect(snap.tables.providerConnections[0].federation_version).toBeGreaterThan(0);

    const wm = computeWatermark(db);
    const delta = await handleDelta({ nextUrl: { searchParams: new URLSearchParams(`since=${wm}`) } });
    expect(delta.maxVersion).toBe(wm);
    expect(delta.schemaVersion).toBe(latestVersion());
    expect(Array.isArray(delta.rows)).toBe(true);
    expect(Array.isArray(delta.tombstones)).toBe(true);

    const verify = await handleVerify({ headers: { get: () => "edge-1" }, nextUrl: { searchParams: new URLSearchParams() } });
    expect(verify.ok).toBe(true);
    expect(verify.role).toBe("central");
    expect(verify.schemaVersion).toBe(latestVersion());
    expect(verify.edgeId).toBe("edge-1");

    const status = await handleStatus();
    expect(status.role).toBe("central");
    expect(status.schemaVersion).toBe(latestVersion());
    expect(status.maxVersion).toBe(wm);
    // FED-016: central never applies a replica → lastAppliedRevision is null
    // (not 0) and revisionLag is 0 with an edge-only annotation — no
    // misleading "self-lag" number.
    expect(status.lastAppliedRevision).toBe(null);
    expect(status.revisionLag).toBe(0);
    expect(status.revisionLagNote).toContain("edge-only");
  });

  it("invalid since → 400", async () => {
    process.env.FEDERATION_MODE = "central";
    vi.resetModules();
    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleDelta, HttpError } = await import("@/lib/federation/server.js");
    try {
      await handleDelta({ nextUrl: { searchParams: new URLSearchParams("since=abc") } });
      expect.unreachable("expected HttpError 400");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(400);
    }
  });
});

// ─── edgeClient ────────────────────────────────────────────────────────

describe("edgeClient", () => {
  it("start() refuses in standalone mode (zero drift hard gate)", async () => {
    delete process.env.FEDERATION_MODE;
    vi.resetModules();
    const { start } = await import("@/lib/federation/edgeClient.js");
    expect(start()).toBeNull();
  });

  it("start() refuses in non-edge modes", async () => {
    process.env.FEDERATION_MODE = "central";
    vi.resetModules();
    const { start } = await import("@/lib/federation/edgeClient.js");
    expect(start()).toBeNull();
  });

  it("pullOnce bootstraps from snapshot then applies deltas via fetch", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_EDGE_ID = "edge-test-1";
    vi.resetModules();

    const central = await createMigratedDb();
    const { buildSnapshot, buildDelta, computeWatermark } = await import("@/lib/federation/replication.js");
    const { dbApi, ids } = await seedCentral(central);
    const snap = buildSnapshot(central);

    const edge = await createMigratedDb();
    pointDriverAt(edge);

    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes("/snapshot")) return { ok: true, json: async () => snap };
      const since = Number(new URL(url).searchParams.get("since"));
      return { ok: true, json: async () => buildDelta(central, since) };
    };

    const { pullOnce } = await import("@/lib/federation/edgeClient.js");
    const r1 = await pullOnce({ fetchImpl, centralUrl: "http://central.test" });
    expect(r1.ok).toBe(true);
    expect(r1.applied).toBe(true);
    expect(r1.lastAppliedRevision).toBe(snap.maxVersion);
    expect(calls[0]).toContain("/api/federation/snapshot?since=0");
    expect(edge.get(`SELECT COUNT(*) AS c FROM providerConnections`).c).toBe(1);

    // Central changes; next pull is a delta from the edge's revision.
    // (Re-point the driver at central for the write, then back to edge.)
    pointDriverAt(central);
    await dbApi.updateProviderConnection(ids.conn, { name: "renamed" });
    pointDriverAt(edge);
    const r2 = await pullOnce({ fetchImpl, centralUrl: "http://central.test" });
    expect(r2.ok).toBe(true);
    expect(r2.applied).toBe(true);
    expect(calls[1]).toContain(`/api/federation/delta?since=${snap.maxVersion}`);
    expect(edge.get(`SELECT name FROM providerConnections`).name).toBe("renamed");
  });

  it("pullOnce returns blocked on SCHEMA_BLOCKED and does not advance revision", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_EDGE_ID = "edge-test-2";
    vi.resetModules();

    const central = await createMigratedDb();
    const { buildSnapshot } = await import("@/lib/federation/replication.js");
    await seedCentral(central);
    const snap = { ...buildSnapshot(central), schemaVersion: 999 };

    const edge = await createMigratedDb();
    pointDriverAt(edge);

    const fetchImpl = async () => ({ ok: true, json: async () => snap });
    const { pullOnce } = await import("@/lib/federation/edgeClient.js");
    const r = await pullOnce({ fetchImpl, centralUrl: "http://central.test" });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.error).toContain("SCHEMA_BLOCKED");
    // Nothing applied, revision untouched, blocked flag recorded
    expect(edge.get(`SELECT COUNT(*) AS c FROM providerConnections`).c).toBe(0);
    expect(edge.get(`SELECT value FROM _meta WHERE key='federation_schemaBlocked'`).value).toBe("1");
  });

  it("pullOnce returns ok:false on HTTP errors (loop keeps running)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_EDGE_ID = "edge-test-3";
    vi.resetModules();
    const edge = await createMigratedDb();
    pointDriverAt(edge);
    const fetchImpl = async () => ({ ok: false, status: 500 });
    const { pullOnce } = await import("@/lib/federation/edgeClient.js");
    const r = await pullOnce({ fetchImpl, centralUrl: "http://central.test" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("HTTP 500");
  });
});
