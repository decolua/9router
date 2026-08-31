// Federation replication service (FED-002).
//
// Central-side serialization (snapshot/delta + revision watermark) and
// edge-side apply (transactional per revision batch, idempotent, schema
// gated). Pure module — no side effects on import; every function takes the
// adapter explicitly so tests can drive any SQLite backend.
//
// Revision model (spec §3.3):
//   - Every write to a replicated table stamps federation_version = N+1
//     (see the repo write-path hooks) and updated_at = ISO string.
//   - Deletes are tombstones: UPDATE ... SET deleted = 1, federation_version
//     = federation_version + 1 (rows are never hard-deleted).
//   - The watermark is max(federation_version) across the 7 physical tables.
//   - An edge's progress is federation_meta.lastAppliedRevision (single
//     source of truth). lastAppliedRevision === watermark ⇒ fully caught up.
//
// Schema gating: the central advertises its migration version (schemaVersion).
// An edge whose local migration version is LOWER than the central's must not
// apply rows it cannot interpret → SCHEMA_BLOCKED pause (no partial apply).
// After the edge upgrades (new migration lands), apply resumes from the same
// lastAppliedRevision — nothing is lost because deltas are version-ordered.
import { REPLICATE_TABLES, REPLICATE_TABLES_PHYSICAL } from "./constants.js";
import { latestVersion } from "../db/migrations/index.js";
import { parseJson, stringifyJson } from "../db/helpers/jsonCol.js";

// Logical table name → physical table. modelAliases/pricing live in kv.
const LOGICAL_TO_PHYSICAL = {
  settings: "settings",
  providerConnections: "providerConnections",
  providerNodes: "providerNodes",
  proxyPools: "proxyPools",
  apiKeys: "apiKeys",
  modelAliases: "kv",
  combos: "combos",
  pricing: "kv",
};

// kv scopes that participate in replication (the spec's 8 logical tables).
// customModels/mitmAlias/disabledModels are NOT replicated (host-local).
const KV_REPLICATE_SCOPES = ["modelAliases", "pricing"];

// Sentinel error for schema mismatch (spec §3.3 / §6.3).
export class SchemaBlockedError extends Error {
  constructor(edgeVersion, centralVersion) {
    super(
      `[federation] SCHEMA_BLOCKED: edge schema v${edgeVersion} is older than central schema v${centralVersion}. ` +
        `Upgrade the edge before applying deltas.`
    );
    this.name = "SchemaBlockedError";
    this.code = "SCHEMA_BLOCKED";
    this.edgeVersion = edgeVersion;
    this.centralVersion = centralVersion;
  }
}

// ─── Central-side serialization ──────────────────────────────────────────

// Full snapshot of the 8 logical config tables in exportDb() shape, with
// version columns (federation_version/updated_at/deleted) on every row.
// Rows are serialized as { row: <exportDb-shaped object>, federation_version,
// updated_at, deleted } so the edge can apply them without re-deriving the
// exportDb mapping. settings is a single-row table (id=1). Tombstoned rows
// are excluded (they are not part of a full snapshot — the edge starts from
// a clean slate).
export function buildSnapshot(db) {
  const out = { tables: {}, schemaVersion: latestVersion() };
  for (const table of REPLICATE_TABLES) {
    out.tables[table] = readLogicalTable(db, table).filter((e) => e.deleted !== 1);
  }
  out.maxVersion = computeWatermark(db);
  return out;
}

// Delta of rows with federation_version > since, plus tombstones
// (deleted=1 rows with federation_version > since), the max_version
// watermark and the central schemaVersion. The edge uses maxVersion as its
// next lastAppliedRevision after a successful apply.
export function buildDelta(db, since) {
  const sinceNum = Number.isFinite(Number(since)) ? Math.max(0, Number(since)) : 0;
  const out = {
    since: sinceNum,
    rows: [],
    tombstones: [],
    maxVersion: computeWatermark(db),
    schemaVersion: latestVersion(),
  };
  for (const table of REPLICATE_TABLES) {
    for (const entry of readLogicalTable(db, table, { since: sinceNum })) {
      if (entry.deleted === 1) out.tombstones.push({ table, key: rowKey(table, entry) });
      else out.rows.push({ table, ...entry });
    }
  }
  return out;
}

// max(federation_version) across the 7 physical tables. 0 when nothing has
// ever been stamped (fresh DB).
export function computeWatermark(db) {
  let max = 0;
  for (const table of REPLICATE_TABLES_PHYSICAL) {
    const row = db.get(`SELECT MAX(federation_version) AS m FROM ${table}`);
    const v = row?.m ?? 0;
    if (v > max) max = v;
  }
  return max;
}

// Read one logical table with version columns. When since is given, only
// rows with federation_version > since are returned (delta semantics).
function readLogicalTable(db, table, { since } = {}) {
  const physical = LOGICAL_TO_PHYSICAL[table];
  if (!physical) throw new Error(`[federation] unknown replicated table '${table}'`);
  if (physical === "kv") return readKvTable(db, { since, scope: table });
  const rows = db.all(`SELECT * FROM ${physical}${since !== undefined ? ` WHERE federation_version > ?` : ""}`, since !== undefined ? [since] : []);
  return rows.map((r) => ({
    row: mapPhysicalRow(physical, r),
    federation_version: r.federation_version ?? 0,
    updated_at: r.updated_at ?? null,
    deleted: r.deleted ?? 0,
  }));
}

// kv-backed logical tables (modelAliases, pricing): each kv row is a
// replicated row keyed by scope|key. Only the replicating scopes are read.
function readKvTable(db, { since, scope } = {}) {
  const out = [];
  const scopes = scope ? [scope] : KV_REPLICATE_SCOPES;
  for (const s of scopes) {
    const rows = db.all(
      `SELECT * FROM kv WHERE scope = ?${since !== undefined ? ` AND federation_version > ?` : ""}`,
      since !== undefined ? [s, since] : [s]
    );
    for (const r of rows) {
      out.push({
        row: { scope: r.scope, key: r.key, value: parseJson(r.value) },
        federation_version: r.federation_version ?? 0,
        updated_at: r.updated_at ?? null,
        deleted: r.deleted ?? 0,
      });
    }
  }
  return out;
}

// Reconstruct the exportDb() row shape for a physical table row (mirrors the
// mappings in src/lib/db/index.js exportDb()).
function mapPhysicalRow(table, r) {
  switch (table) {
    case "settings":
      return { id: r.id, data: parseJson(r.data, {}) };
    case "providerConnections":
      return {
        ...parseJson(r.data, {}),
        id: r.id,
        provider: r.provider,
        authType: r.authType,
        name: r.name,
        email: r.email,
        priority: r.priority,
        isActive: r.isActive === 1,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    case "providerNodes":
      return {
        ...parseJson(r.data, {}),
        id: r.id,
        type: r.type,
        name: r.name,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    case "proxyPools":
      return {
        ...parseJson(r.data, {}),
        id: r.id,
        isActive: r.isActive === 1,
        testStatus: r.testStatus,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    case "apiKeys":
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        machineId: r.machineId,
        isActive: r.isActive === 1,
        createdAt: r.createdAt,
      };
    case "combos":
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        models: parseJson(r.models, []),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    default:
      return { ...r };
  }
}

// Stable identity of a row for tombstone matching (kv-backed rows are keyed
// by scope|key; everything else by its primary key).
function rowKey(table, row) {
  if (LOGICAL_TO_PHYSICAL[table] === "kv") return `${row.row.scope}|${row.row.key}`;
  return String(row.row.id ?? row.row.key ?? "");
}

// ─── Edge-side apply ─────────────────────────────────────────────────────

// Apply one revision batch (a snapshot or delta payload) transactionally.
//
// Idempotency: the whole batch is guarded by the batch's maxVersion vs the
// edge's lastAppliedRevision. Re-applying a batch whose maxVersion is <= the
// current lastAppliedRevision is a no-op. Within a batch, every row is
// applied with its own federation_version, so a partially-applied batch can
// never be re-applied (the guard is on the batch watermark, and the batch
// only advances lastAppliedRevision when the ENTIRE batch committed).
//
// Schema gating: when the payload's schemaVersion is greater than the local
// migration version, throws SchemaBlockedError BEFORE touching any row —
// nothing is applied, lastAppliedRevision is untouched, and the caller can
// pause (edgeClient records the blocked state and retries after upgrade).
//
// Returns { applied: boolean, lastAppliedRevision } — applied=false means the
// batch was a no-op (already at or past this revision).
export function applyRevisionBatch(db, payload, { meta = null } = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("[federation] applyRevisionBatch: payload must be an object");
  }
  const centralSchema = Number(payload.schemaVersion ?? latestVersion());
  const localSchema = latestVersion();
  if (centralSchema > localSchema) {
    throw new SchemaBlockedError(localSchema, centralSchema);
  }

  const batchMax = Number(payload.maxVersion ?? payload.max_version ?? 0);
  const current = readLastAppliedRevision(db, meta);

  // Idempotent no-op: already at or beyond this batch's watermark.
  if (batchMax <= current) {
    return { applied: false, lastAppliedRevision: current };
  }

  const rows = payload.rows || [];
  const tombstones = payload.tombstones || [];
  const tables = payload.tables || null; // snapshot shape

  // Validate every referenced table BEFORE opening the transaction so a
  // malformed payload fails fast and nothing is partially applied.
  const referenced = new Set();
  if (tables) {
    for (const t of Object.keys(tables)) referenced.add(t);
  } else {
    for (const r of rows) referenced.add(r?.table);
    for (const t of tombstones) referenced.add(t?.table);
  }
  for (const t of referenced) {
    if (!LOGICAL_TO_PHYSICAL[t]) {
      throw new Error(`[federation] apply: unknown replicated table '${t}'`);
    }
  }

  db.transaction(() => {
    if (tables) {
      // Snapshot: full replace of every replicated table (fresh bootstrap).
      for (const table of REPLICATE_TABLES) {
        clearLogicalTable(db, table);
      }
      for (const table of REPLICATE_TABLES) {
        for (const entry of tables[table] || []) {
          upsertLogicalRow(db, table, entry);
        }
      }
    } else {
      // Delta: upsert changed rows, apply tombstones.
      for (const { table, row } of rows) {
        upsertLogicalRow(db, table, row);
      }
      for (const { table, key } of tombstones) {
        tombstoneLogicalRow(db, table, key);
      }
    }
    writeLastAppliedRevision(db, batchMax, meta);
  });

  return { applied: true, lastAppliedRevision: batchMax };
}

// Read the edge's progress. meta is an optional { get: (key) => value }
// accessor (used by tests to point at a different federation_meta row);
// defaults to the real federation_meta table.
export function readLastAppliedRevision(db, meta = null) {
  if (meta?.get) {
    const v = meta.get("lastAppliedRevision");
    return v == null ? 0 : Number(v);
  }
  const row = db.get(`SELECT lastAppliedRevision FROM federation_meta WHERE id = 1`);
  return row?.lastAppliedRevision == null ? 0 : Number(row.lastAppliedRevision);
}

export function writeLastAppliedRevision(db, revision, meta = null) {
  const rev = Number(revision) || 0;
  if (meta?.set) {
    meta.set("lastAppliedRevision", rev);
    return;
  }
  db.run(
    `INSERT INTO federation_meta(id, lastAppliedRevision) VALUES(1, ?)
     ON CONFLICT(id) DO UPDATE SET lastAppliedRevision = excluded.lastAppliedRevision`,
    [rev]
  );
}

// ─── Row-level apply helpers ─────────────────────────────────────────────

function clearLogicalTable(db, table) {
  const physical = LOGICAL_TO_PHYSICAL[table];
  if (!physical) throw new Error(`[federation] unknown replicated table '${table}'`);
  if (physical === "kv") {
    for (const scope of KV_REPLICATE_SCOPES) {
      db.run(`DELETE FROM kv WHERE scope = ?`, [scope]);
    }
    return;
  }
  db.run(`DELETE FROM ${physical}`);
}

// Upsert one wire row into its physical table, preserving the row's own
// federation_version/updated_at/deleted so the replica's watermark matches
// the central's exactly. `table` is the LOGICAL table name (modelAliases/
// pricing map to kv rows).
function upsertLogicalRow(db, table, entry) {
  const physical = LOGICAL_TO_PHYSICAL[table];
  if (!physical) throw new Error(`[federation] apply: unknown replicated table '${table}'`);
  const row = entry?.row ?? entry;
  const fv = Number(entry?.federation_version ?? 0);
  const updatedAt = entry?.updated_at ?? null;
  const deleted = Number(entry?.deleted ?? 0);

  if (physical === "kv") {
    db.run(
      `INSERT INTO kv(scope, key, value, federation_version, updated_at, deleted)
       VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         value = excluded.value,
         federation_version = excluded.federation_version,
         updated_at = excluded.updated_at,
         deleted = excluded.deleted`,
      [row.scope, row.key, stringifyJson(row.value), fv, updatedAt, deleted]
    );
    return;
  }

  switch (physical) {
    case "settings": {
      db.run(
        `INSERT INTO settings(id, data, federation_version, updated_at, deleted)
         VALUES(1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           data = excluded.data,
           federation_version = excluded.federation_version,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
        [stringifyJson(row.data ?? {}), fv, updatedAt, deleted]
      );
      break;
    }
    case "providerConnections": {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = row;
      db.run(
        `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt, federation_version, updated_at, deleted)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider, authType = excluded.authType, name = excluded.name,
           email = excluded.email, priority = excluded.priority, isActive = excluded.isActive,
           data = excluded.data, updatedAt = excluded.updatedAt,
           federation_version = excluded.federation_version,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
        [id, provider, authType || "oauth", name ?? null, email ?? null, priority ?? null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString(), fv, updatedAt, deleted]
      );
      break;
    }
    case "providerNodes": {
      const { id, type, name, createdAt, updatedAt, ...rest } = row;
      db.run(
        `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt, federation_version, updated_at, deleted)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type, name = excluded.name, data = excluded.data, updatedAt = excluded.updatedAt,
           federation_version = excluded.federation_version,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
        [id, type ?? null, name ?? null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString(), fv, updatedAt, deleted]
      );
      break;
    }
    case "proxyPools": {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = row;
      db.run(
        `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt, federation_version, updated_at, deleted)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           isActive = excluded.isActive, testStatus = excluded.testStatus,
           data = excluded.data, updatedAt = excluded.updatedAt,
           federation_version = excluded.federation_version,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
        [id, isActive === false ? 0 : 1, testStatus ?? null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString(), fv, updatedAt, deleted]
      );
      break;
    }
    case "apiKeys": {
      db.run(
        `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, federation_version, updated_at, deleted)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           key = excluded.key, name = excluded.name, machineId = excluded.machineId,
           isActive = excluded.isActive, createdAt = excluded.createdAt,
           federation_version = excluded.federation_version,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
        [row.id, row.key, row.name ?? null, row.machineId ?? null, row.isActive === false ? 0 : 1, row.createdAt || new Date().toISOString(), fv, updatedAt, deleted]
      );
      break;
    }
    case "combos": {
      db.run(
        `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt, federation_version, updated_at, deleted)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, kind = excluded.kind, models = excluded.models,
           createdAt = excluded.createdAt, updatedAt = excluded.updatedAt,
           federation_version = excluded.federation_version,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted`,
        [row.id, row.name, row.kind ?? null, stringifyJson(row.models || []), row.createdAt || new Date().toISOString(), row.updatedAt || new Date().toISOString(), fv, updatedAt, deleted]
      );
      break;
    }
    default:
      throw new Error(`[federation] apply: unknown replicated table '${table}'`);
  }
}

// Apply a tombstone: mark the row deleted=1 (never hard-delete replicated
// rows). kv tombstones carry scope|key; physical tables carry the row id.
function tombstoneLogicalRow(db, table, key) {
  if (table === "kv") {
    const idx = String(key).indexOf("|");
    if (idx <= 0) return;
    const scope = String(key).slice(0, idx);
    const k = String(key).slice(idx + 1);
    db.run(
      `UPDATE kv SET deleted = 1, federation_version = federation_version + 1, updated_at = ?
       WHERE scope = ? AND key = ?`,
      [new Date().toISOString(), scope, k]
    );
    return;
  }
  db.run(
    `UPDATE ${table} SET deleted = 1, federation_version = federation_version + 1, updated_at = ?
     WHERE id = ?`,
    [new Date().toISOString(), key]
  );
}
