// FED-GAP-15 — FEDERATION_REDACT_FIELDS wiring (edge-side apply redaction).
//
// getRedactFields() (config.js) was documented (.env.example, docker-compose
// .federation.yml, docs/FEDERATION.md env matrix) but had ZERO production
// callers — a proxy-only edge that set the var saw no error and its local
// replica still received full provider credentials/API keys.
//
// Pinned criteria:
//  1. edge + var set → listed fields are redacted in the replica DB rows for
//     providerConnections AND apiKeys after a snapshot apply AND a delta
//     apply; nested dot paths (data.apiKey, the documented spelling) work.
//  2. edge + var UNSET → replicated rows are byte-identical to the
//     no-redaction baseline (getRedactFields() === [] must be a structural
//     no-op).
//  3. standalone/central roles → redaction NEVER applied even with the var
//     set (federation stays a default no-op).
//  4. envelope untouched: federation_version / updated_at / deleted /
//     tombstones / watermark all preserved (row VALUES only are transformed).
//
// Env note: config.js parses FEDERATION_MODE once at import, so mode is set
// BEFORE the config import; FEDERATION_REDACT_FIELDS is read at call time
// (getRedactFields()), but tests reset modules anyway so every import path
// starts clean. Mirrors tests/federation/replication.test.js harness.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { latestVersion } from "@/lib/db/migrations/index.js";

const FED_ENV_KEYS = [
  "FEDERATION_MODE",
  "FEDERATION_REDACT_FIELDS",
  "FEDERATION_CENTRAL_URL",
  "FEDERATION_EDGE_ID",
  "FEDERATION_SYNC_INTERVAL_MS",
  "FEDERATION_TOKEN",
];

let tempDir;
let savedEnv = {};
let savedDataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-redact-"));
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

// Same driver-pin pattern as replication.test.js — driver.js captures the
// global._dbAdapter object at module load, so the object is mutated in place.
function pointDriverAt(db) {
  if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
  global._dbAdapter.instance = db;
  global._dbAdapter.initPromise = Promise.resolve(db);
  global._dbAdapter.logged = true;
}

// ─── Harness: fresh migrated DB + seeded credentials ────────────────────
async function loadAdapterFactories() {
  const factories = [];
  try {
    const mod = await import("@/lib/db/adapters/betterSqliteAdapter.js");
    factories.push({ name: "better-sqlite3", create: (file) => mod.createBetterSqliteAdapter(file) });
  } catch (e) {
    console.warn(`[test] better-sqlite3 unavailable: ${e.message}`);
  }
  return factories;
}

let _dbSeq = 0;

async function createMigratedDb() {
  const factories = await loadAdapterFactories();
  const factory = factories[0];
  const file = path.join(tempDir, `${factory.name.replace(":", "-")}-${++_dbSeq}.sqlite`);
  const db = await factory.create(file);
  const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
  const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");
  const { default: m003 } = await import("@/lib/db/migrations/003-federation-state.js");
  const { default: m004 } = await import("@/lib/db/migrations/004-federation-fencing.js");
  const { default: m005 } = await import("@/lib/db/migrations/005-federation-central-watermark.js");
  m001.up(db);
  m002.up(db);
  m003.up(db);
  m004.up(db);
  m005.up(db);
  return db;
}

// Seed ONE central DB with a credential-bearing providerConnection
// (authType=apikey, apiKey in the data column — the wire row spreads it
// top-level, so path "data.apiKey" aliases to the top-level field) and one
// apiKeys row. Returns the raw secret values for redaction assertions.
async function seedCentralWithCredentials(db) {
  pointDriverAt(db);
  const dbApi = await import("@/lib/db/index.js");

  const conn = await dbApi.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "main",
    apiKey: "target-credential-abcdef123456",
    providerSpecificData: { nested: { secret: "nested-secret-value", keep: "kept-value" } },
  });
  const key = await dbApi.createApiKey("k1", "machine-1");
  await dbApi.setModelAlias("alias1", "real-model-1");
  return { dbApi, ids: { conn: conn.id, key: key.id }, secrets: { connApiKey: "target-credential-abcdef123456", nestedSecret: "nested-secret-value" } };
}

// Set the edge role BEFORE replication.js is imported (config parses mode
// once at import time).
function setMode(mode) {
  if (mode) process.env.FEDERATION_MODE = mode;
  else delete process.env.FEDERATION_MODE;
  vi.resetModules();
}

describe("FED-GAP-15: edge-side FEDERATION_REDACT_FIELDS wiring", () => {
  it("criterion 1 — edge + var set: snapshot apply redacts providerConnections apiKey (data.apiKey path) and apiKeys key in the replica", async () => {
    setMode("edge");
    process.env.FEDERATION_REDACT_FIELDS = "data.apiKey,key,providerSpecificData.nested.secret";
    process.env.FEDERATION_EDGE_ID = "edge-redact-1";

    const central = await createMigratedDb();
    const { dbApi, ids, secrets } = await seedCentralWithCredentials(central);
    const { buildSnapshot, applyRevisionBatch } = await import("@/lib/federation/replication.js");
    const snap = buildSnapshot(central);

    // Sanity: the snapshot (central-side) still carries the full secrets.
    const cRow = snap.tables.providerConnections.find((e) => e.row.id === ids.conn);
    expect(cRow.row.apiKey).toBe(secrets.connApiKey);
    expect(snap.tables.apiKeys.find((e) => e.row.id === ids.key).row.key).toMatch(/^sk-./);

    const edge = await createMigratedDb();
    applyRevisionBatch(edge, snap);

    // Replica providerConnections: the data column (spread top-level on the
    // wire) must NOT carry the credential; the marker is null (no leak via
    // equality against the original).
    const eData = JSON.parse(edge.get(`SELECT data FROM providerConnections WHERE id = ?`, [ids.conn]).data);
    expect(eData.apiKey).toBe(null);
    expect(JSON.stringify(eData)).not.toContain(secrets.connApiKey);
    // Nested dot path inside providerSpecificData also redacts.
    expect(eData.providerSpecificData.nested.secret).toBe(null);
    expect(JSON.stringify(eData)).not.toContain(secrets.nestedSecret);
    // Non-listed fields are untouched.
    expect(eData.providerSpecificData.nested.keep).toBe("kept-value");
    expect(edge.get(`SELECT provider, authType FROM providerConnections WHERE id = ?`, [ids.conn])).toEqual({ provider: "openai", authType: "apikey" });

    // Replica apiKeys: the credential column is the constant non-reversible
    // marker (per-row suffix, since key is UNIQUE NOT NULL — null cannot be
    // stored there).
    const eKey = edge.get(`SELECT key, name, machineId FROM apiKeys WHERE id = ?`, [ids.key]);
    expect(eKey.key).toBe("[redacted]:" + ids.key);
    expect(eKey.key).not.toContain(secrets.connApiKey.slice(0, 6));
    expect(eKey.name).toBe("k1");
    expect(eKey.machineId).toBe("machine-1");

    // Central itself keeps serving full rows (redaction is edge-side only).
    expect(JSON.parse(central.get(`SELECT data FROM providerConnections WHERE id = ?`, [ids.conn]).data).apiKey).toBe(secrets.connApiKey);
    expect(central.get(`SELECT key FROM apiKeys WHERE id = ?`, [ids.key]).key).toMatch(/^sk-/);

    // Version metadata on the replica row is untouched by redaction.
    const eMeta = edge.get(`SELECT federation_version, updated_at, deleted FROM providerConnections WHERE id = ?`, [ids.conn]);
    const cMeta = central.get(`SELECT federation_version, updated_at, deleted FROM providerConnections WHERE id = ?`, [ids.conn]);
    expect(eMeta).toEqual(cMeta);
    expect(eMeta.federation_version).toBeGreaterThan(0);
  });

  it("criterion 1 — edge + var set: delta apply redacts too (both wire shapes)", async () => {
    setMode("edge");
    process.env.FEDERATION_REDACT_FIELDS = "data.apiKey,key";
    process.env.FEDERATION_EDGE_ID = "edge-redact-2";

    const central = await createMigratedDb();
    const { dbApi, ids, secrets } = await seedCentralWithCredentials(central);
    const { buildSnapshot, buildDelta, applyRevisionBatch } = await import("@/lib/federation/replication.js");

    const edge = await createMigratedDb();
    applyRevisionBatch(edge, buildSnapshot(central));

    // Central re-stamps the connection (delta path) and adds a second key.
    await dbApi.updateProviderConnection(ids.conn, { name: "renamed" });
    const delta = buildDelta(central, /* since */ 0);
    const connEntry = delta.rows.find((r) => r.table === "providerConnections");
    expect(connEntry.row.apiKey).toBe(secrets.connApiKey); // central-side wire row still full

    applyRevisionBatch(edge, delta);

    const eData = JSON.parse(edge.get(`SELECT data FROM providerConnections WHERE id = ?`, [ids.conn]).data);
    expect(eData.apiKey).toBe(null);
    expect(JSON.stringify(eData)).not.toContain(secrets.connApiKey);
    // The delta-applied business update (name is a dedicated column, not data JSON) landed.
    expect(edge.get(`SELECT name FROM providerConnections WHERE id = ?`, [ids.conn]).name).toBe("renamed");
    // The delta-applied row keeps its entry version metadata (envelope intact).
    const eRow = edge.get(`SELECT federation_version, updated_at FROM providerConnections WHERE id = ?`, [ids.conn]);
    expect(eRow.federation_version).toBe(connEntry.federation_version);
    expect(eRow.updated_at).toBe(connEntry.updated_at);
  });

  it("criterion 2 — edge + var UNSET: replicated rows byte-identical to the no-op baseline", async () => {
    setMode("edge");
    // FEDERATION_REDACT_FIELDS deliberately not set.
    process.env.FEDERATION_EDGE_ID = "edge-noop-1";

    const central = await createMigratedDb();
    const { dbApi, ids, secrets } = await seedCentralWithCredentials(central);
    const { buildSnapshot, buildDelta, applyRevisionBatch } = await import("@/lib/federation/replication.js");
    const snap = buildSnapshot(central);

    const edge = await createMigratedDb();
    applyRevisionBatch(edge, snap);

    // Replica row is byte-identical to the central row (both wire shapes).
    const eConn = edge.get(`SELECT * FROM providerConnections WHERE id = ?`, [ids.conn]);
    const cConn = central.get(`SELECT * FROM providerConnections WHERE id = ?`, [ids.conn]);
    expect(JSON.parse(eConn.data)).toEqual(JSON.parse(cConn.data));
    expect(JSON.parse(eConn.data).apiKey).toBe(secrets.connApiKey);

    const delta = buildDelta(central, 0);
    const edge2 = await createMigratedDb();
    applyRevisionBatch(edge2, delta);
    const e2Conn = edge2.get(`SELECT * FROM providerConnections WHERE id = ?`, [ids.conn]);
    expect(JSON.parse(e2Conn.data)).toEqual(JSON.parse(cConn.data));
    const e2Key = edge2.get(`SELECT key FROM apiKeys WHERE id = ?`, [ids.key]);
    expect(e2Key.key).toBe(central.get(`SELECT key FROM apiKeys WHERE id = ?`, [ids.key]).key);
  });

  it("criterion 3 — standalone/central: redaction NEVER applied even when the var is set", async () => {
    const central = await createMigratedDb();
    const { dbApi, ids, secrets } = await seedCentralWithCredentials(central);
    const { buildSnapshot, buildDelta, applyRevisionBatch } = await import("@/lib/federation/replication.js");

    // The var is read at CALL time by getRedactFields(), so it is set once
    // up front and every role below sees it set — redaction must still never
    // fire outside the edge role.
    process.env.FEDERATION_REDACT_FIELDS = "data.apiKey,key";

    const snap = buildSnapshot(central);

    // CENTRAL mode applying a (replayed/foreign) batch: rows stay full.
    setMode("central");
    const r1 = await import("@/lib/federation/replication.js");
    const cfg = await import("@/lib/federation/config.js");
    expect(cfg.getRedactFields()).toEqual(["data.apiKey", "key"]);
    const central2 = await createMigratedDb();
    r1.applyRevisionBatch(central2, snap);
    expect(JSON.parse(central2.get(`SELECT data FROM providerConnections WHERE id = ?`, [ids.conn]).data).apiKey).toBe(secrets.connApiKey);
    expect(central2.get(`SELECT key FROM apiKeys WHERE id = ?`, [ids.key]).key).toMatch(/^sk-/);

    // STANDALONE mode: same.
    delete process.env.FEDERATION_MODE;
    vi.resetModules();
    const r2 = await import("@/lib/federation/replication.js");
    const standalone = await createMigratedDb();
    r2.applyRevisionBatch(standalone, snap);
    expect(JSON.parse(standalone.get(`SELECT data FROM providerConnections WHERE id = ?`, [ids.conn]).data).apiKey).toBe(secrets.connApiKey);
    expect(standalone.get(`SELECT key FROM apiKeys WHERE id = ?`, [ids.key]).key).toMatch(/^sk-/);

    // The central-SIDE serialization itself never redacts, regardless of mode.
    expect(snap.tables.providerConnections[0].row.apiKey).toBe(secrets.connApiKey);
    const delta = buildDelta(central, 0);
    expect(delta.rows.find((r) => r.table === "apiKeys").row.key).toMatch(/^sk-/);
  });

  it("criterion 4 — envelope untouched: watermark/tombstones/idempotency unchanged under redaction", async () => {
    setMode("edge");
    process.env.FEDERATION_REDACT_FIELDS = "data.apiKey,key";
    process.env.FEDERATION_EDGE_ID = "edge-redact-3";

    const central = await createMigratedDb();
    const { dbApi, ids, secrets } = await seedCentralWithCredentials(central);
    const { buildSnapshot, buildDelta, computeWatermark, applyRevisionBatch, readLastAppliedRevision } = await import("@/lib/federation/replication.js");

    const snap = buildSnapshot(central);
    const edge = await createMigratedDb();
    const first = applyRevisionBatch(edge, snap);
    expect(first.applied).toBe(true);
    expect(first.lastAppliedRevision).toBe(snap.maxVersion);
    expect(readLastAppliedRevision(edge)).toBe(snap.maxVersion);
    expect(computeWatermark(edge)).toBe(snap.maxVersion);

    // Idempotency intact under redaction: re-apply is a no-op.
    const second = applyRevisionBatch(edge, snap);
    expect(second.applied).toBe(false);

    // Delta + tombstone round-trip: redacted rows still apply with the entry
    // metadata intact, and tombstones still land. NOTE: tombstones carry no
    // federation_version on the wire (buildDelta emits { table, key } only) —
    // the edge bumps its local row version +1 at tombstone time, so the LOCAL
    // watermark after a tombstone-bearing batch sits BELOW the advertised
    // maxVersion by design (pre-existing semantics, identical without
    // redaction). lastAppliedRevision/centralMaxVersion stay exact.
    await dbApi.updateProviderConnection(ids.conn, { name: "renamed" });
    await dbApi.deleteApiKey(ids.key);
    const delta = buildDelta(central, snap.maxVersion);
    expect(delta.tombstones.some((t) => t.table === "apiKeys" && t.key === ids.key)).toBe(true);
    const res = applyRevisionBatch(edge, delta);
    expect(res.applied).toBe(true);
    expect(res.lastAppliedRevision).toBe(delta.maxVersion);
    expect(edge.get(`SELECT COUNT(*) AS c FROM apiKeys WHERE deleted=0`).c).toBe(0);
    const eKeyRow = edge.get(`SELECT deleted, federation_version FROM apiKeys WHERE id = ?`, [ids.key]);
    expect(eKeyRow.deleted).toBe(1);
    expect(eKeyRow.federation_version).toBeGreaterThan(0);
  });

  it("criterion 4b — unknown/nested-into-primitive paths are silently ignored, sync never fails", async () => {
    setMode("edge");
    process.env.FEDERATION_REDACT_FIELDS = "does.not.exist,provider.nested";
    process.env.FEDERATION_EDGE_ID = "edge-redact-4";

    const central = await createMigratedDb();
    const { dbApi, ids } = await seedCentralWithCredentials(central);
    const { buildSnapshot, applyRevisionBatch } = await import("@/lib/federation/replication.js");

    const edge = await createMigratedDb();
    const res = applyRevisionBatch(edge, buildSnapshot(central));
    expect(res.applied).toBe(true);
    // provider is a top-level string hop → not object, ignored; row intact.
    expect(edge.get(`SELECT provider FROM providerConnections WHERE id = ?`, [ids.conn]).provider).toBe("openai");
    expect(JSON.parse(edge.get(`SELECT data FROM providerConnections WHERE id = ?`, [ids.conn]).data).apiKey).toBe("target-credential-abcdef123456");
  });

  it("criterion 1 — nested dot path in kv-backed tables is NOT redacted (scope limited to the credential tables)", async () => {
    setMode("edge");
    process.env.FEDERATION_REDACT_FIELDS = "value,value.alias1";
    process.env.FEDERATION_EDGE_ID = "edge-redact-5";

    const central = await createMigratedDb();
    await seedCentralWithCredentials(central);
    const { buildSnapshot, applyRevisionBatch } = await import("@/lib/federation/replication.js");

    const edge = await createMigratedDb();
    applyRevisionBatch(edge, buildSnapshot(central));
    // modelAliases is kv-backed and not in the redaction scope: untouched.
    const alias = JSON.parse(edge.get(`SELECT value FROM kv WHERE scope='modelAliases' AND key='alias1'`).value);
    expect(alias).toBe("real-model-1");
  });
});