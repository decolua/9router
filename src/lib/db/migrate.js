import fs from "node:fs";
import path from "node:path";
import { LEGACY_FILES, DB_DIR } from "./paths.js";
import { TABLES, buildCreateTableSql, SCHEMA_VERSION } from "./schema.js";
import { MIGRATIONS, latestVersion } from "./migrations/index.js";
import { getMetaSync, setMetaSync } from "./helpers/metaStore.js";
import { makeBackupDir, backupFile, backupDbLite, pruneOldBackups } from "./backup.js";
import { getAppVersion } from "./version.js";
import { stringifyJson } from "./helpers/jsonCol.js";

// Marker file: prevents re-importing legacy JSON when user wipes data.sqlite.
const MIGRATED_MARKER = path.join(DB_DIR, ".migrated-from-json");

// Track per-adapter so reusing same adapter skips re-run, but new adapter (after reset) re-runs.
const _migratedAdapters = new WeakSet();

// Thrown when row-count assertion fails. The import transaction rolls back
// (no partial rows), legacy db.json is kept, and _meta.importStatus is set to
// "aborted" — the NEXT boot retries the import (H-1 fix: previously the
// already-committed schemaVersion made isFreshDb() false forever and the
// import was skipped for the life of the DB).
export class MigrationAborted extends Error {
  constructor(message, droppedRows) {
    super(message);
    this.name = "MigrationAborted";
    this.droppedRows = droppedRows;
  }
}

// Insert rows one-by-one, collect failures, then assert COUNT(*) matches input length.
// strict (first-ever attempt): every input row must occupy its own row — a
//   row-count mismatch means silent data loss, so abort and keep the JSON.
// lenient (retry of an aborted/pending import, or recovery of a DB frozen by
//   the old bug): rows collapsing onto an already-present identical PK via
//   INSERT OR REPLACE are tolerated (logged), but rows that genuinely FAIL to
//   insert still abort. Retry stays idempotent because the previous attempt
//   was fully rolled back.
function importWithAssertion(adapter, tableName, rows, insertFn, rowMeta, opts = {}) {
  const lenient = !!opts.lenient;
  const before = countRows(adapter, tableName);
  const dropped = [];
  rows.forEach((row, i) => {
    try { insertFn(row); }
    catch (err) { dropped.push({ ...rowMeta(row), _index: i, reason: err.message }); }
  });
  const inserted = countRows(adapter, tableName);
  if (lenient) {
    if (dropped.length) {
      console.warn(`[DB][migrate] ${tableName} retry still dropped ${dropped.length} row(s). Dropped:`, dropped);
      throw new MigrationAborted(`${tableName} retry dropped ${dropped.length} row(s)`, dropped);
    }
    const expected = uniqueRowIds(rows, rowMeta);
    if (inserted - before < expected) {
      console.warn(`[DB][migrate] ${tableName} retry row-count mismatch: expected >= ${expected} new rows, got ${inserted - before}`);
      throw new MigrationAborted(`${tableName} retry row-count mismatch: expected >= ${expected} new rows, got ${inserted - before}`, []);
    }
    if (rows.length > expected) {
      console.warn(`[DB][migrate] ${tableName} retry: tolerating ${rows.length - expected} duplicate-id row(s) collapsed by INSERT OR REPLACE`);
    }
    return;
  }
  if (inserted !== rows.length) {
    console.warn(`[DB][migrate] ${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}. Dropped:`, dropped);
    throw new MigrationAborted(`${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}`, dropped);
  }
}

function countRows(adapter, tableName) {
  return adapter.get(`SELECT COUNT(*) as c FROM ${tableName}`)?.c ?? 0;
}

// Distinct ids among input rows (null/missing ids counted individually).
function uniqueRowIds(rows, rowMeta) {
  const seen = new Set();
  let n = 0;
  for (const r of rows) {
    const id = rowMeta(r)?.id;
    if (id == null) { n += 1; continue; }
    if (!seen.has(id)) { seen.add(id); n += 1; }
  }
  return n;
}

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

function isFreshDb(adapter) {
  // Table _meta may not exist yet on truly fresh DB
  try {
    const row = adapter.get(`SELECT COUNT(*) as c FROM _meta`);
    return !row || row.c === 0;
  } catch {
    return true;
  }
}

// Tables whose content means "this DB holds real data" for legacy-import
// retry decisions. `settings` is deliberately excluded: the app bootstraps a
// settings row on first run even for a DB frozen by the old H-1 bug, so it is
// not evidence of a completed import. requestDetails/kv-adjacent observability
// rows are similarly weak; kv counts because an imported DB always has rows
// there when the legacy JSON had aliases/pricing, and an empty kv cannot
// collide with an import.
const IMPORT_ENTITY_TABLES = [
  "providerConnections", "providerNodes", "proxyPools", "apiKeys", "combos", "usageHistory", "kv",
];

function dbHasImportedData(adapter) {
  for (const t of IMPORT_ENTITY_TABLES) {
    try {
      if (countRows(adapter, t) > 0) return true;
    } catch { /* table not created yet — treat as empty */ }
  }
  return false;
}

// ─── Versioned migrations runner (skip-version safe) ─────────────────────
function runVersionedMigrations(adapter) {
  // Bootstrap _meta first so we can read schemaVersion
  adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

  const current = parseInt(getMetaSync(adapter, "schemaVersion", "0"), 10) || 0;
  const target = latestVersion();
  if (current >= target) return { applied: 0, from: current, to: current };

  const pending = MIGRATIONS.filter((m) => m.version > current);
  let lastApplied = current;
  for (const m of pending) {
    adapter.transaction(() => {
      m.up(adapter);
      setMetaSync(adapter, "schemaVersion", m.version);
    });
    lastApplied = m.version;
    console.log(`[DB][migrate] applied #${m.version} ${m.name}`);
  }
  return { applied: pending.length, from: current, to: lastApplied };
}

// ─── Auto-sync (additive only): add missing tables/columns/indexes ───────
// Exported for tests. Failures never throw out of boot, but they MUST be
// visible: an index/constraint that silently stops existing is schema drift
// waiting to bite (T1.4 L-4).
export function syncSchemaFromTables(adapter) {
  for (const [tableName, def] of Object.entries(TABLES)) {
    // Create table if absent
    adapter.exec(buildCreateTableSql(tableName, def));

    // Diff columns
    const existing = adapter.all(`PRAGMA table_info(${tableName})`);
    const existingNames = new Set(existing.map((r) => r.name));
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName)) {
        // SQLite ADD COLUMN restrictions: no PRIMARY KEY / UNIQUE w/o NULL ok.
        // We strip PRIMARY KEY / UNIQUE since those are only valid at create time.
        const safeDef = colDef
          .replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "")
          .replace(/UNIQUE/i, "")
          .trim();
        try {
          adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}`);
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e) {
          console.warn(`[DB][sync] ⚠️ WARNING add column ${tableName}.${colName} FAILED (column missing — schema drift): ${e.message}`);
        }
      }
    }

    // Indexes (idempotent)
    for (const idx of def.indexes || []) {
      try { adapter.exec(idx); } catch (e) {
        const name = /CREATE\s+(?:UNIQUE\s+)?(?:VIRTUAL\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?["`\[]?([\w.]+)["`\]]?/i.exec(idx)?.[1] || `${tableName} index`;
        console.warn(`[DB][sync] ⚠️ WARNING failed to create index ${name} on ${tableName} (index/constraint degraded): ${e.message}`);
      }
    }
  }
}

// ─── Legacy JSON import (one-time, retryable) ────────────────────────────
function importLegacyMain(adapter, data, opts = {}) {
  if (!data || typeof data !== "object") return;
  const lenient = !!opts.lenient;

  if (data.settings) {
    // First-ever import (fresh DB): legacy settings win. Retry/recovery import:
    // never clobber settings the user has touched since the abort.
    adapter.run(
      lenient
        ? `INSERT OR IGNORE INTO settings(id, data) VALUES(1, ?)`
        : `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(data.settings)]
    );
  }

  importWithAssertion(adapter, "providerConnections", data.providerConnections || [], (c) => {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
    adapter.run(
      `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (c) => ({ id: c.id ?? null, provider: c.provider ?? null, name: c.name ?? null }), { lenient });

  importWithAssertion(adapter, "providerNodes", data.providerNodes || [], (n) => {
    const { id, type, name, createdAt, updatedAt, ...rest } = n;
    adapter.run(
      `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (n) => ({ id: n.id ?? null, type: n.type ?? null, name: n.name ?? null }), { lenient });

  importWithAssertion(adapter, "proxyPools", data.proxyPools || [], (p) => {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
    adapter.run(
      `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (p) => ({ id: p.id ?? null }), { lenient });

  importWithAssertion(adapter, "apiKeys", data.apiKeys || [], (k) => {
    adapter.run(
      `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
    );
  }, (k) => ({ id: k.id ?? null, name: k.name ?? null }), { lenient });

  importWithAssertion(adapter, "combos", data.combos || [], (c) => {
    adapter.run(
      `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
    );
  }, (c) => ({ id: c.id ?? null, name: c.name ?? null }), { lenient });

  for (const [alias, model] of Object.entries(data.modelAliases || {})) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [alias, stringifyJson(model)]);
  }
  for (const m of data.customModels || []) {
    const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
  }
  for (const [tool, mappings] of Object.entries(data.mitmAlias || {})) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
  }
  for (const [provider, models] of Object.entries(data.pricing || {})) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
  }
}

function importLegacyUsage(adapter, data) {
  if (!data || typeof data !== "object") return;
  for (const e of data.history || []) {
    const t = e.tokens || {};
    adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.timestamp || new Date().toISOString(),
        e.provider || null, e.model || null, e.connectionId || null, e.apiKey || null, e.endpoint || null,
        t.prompt_tokens || t.input_tokens || 0,
        t.completion_tokens || t.output_tokens || 0,
        e.cost || 0,
        e.status || "ok",
        stringifyJson(t),
        stringifyJson({}),
      ]
    );
  }
  for (const [dateKey, day] of Object.entries(data.dailySummary || {})) {
    adapter.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, stringifyJson(day)]);
  }
  if (typeof data.totalRequestsLifetime === "number") {
    setMetaSync(adapter, "totalRequestsLifetime", data.totalRequestsLifetime);
  }
}

function importLegacyDisabled(adapter, data) {
  if (!data || typeof data.disabled !== "object") return;
  for (const [provider, ids] of Object.entries(data.disabled)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('disabledModels', ?, ?)`, [provider, stringifyJson(ids || [])]);
  }
}

function importLegacyDetails(adapter, data) {
  if (!data || !Array.isArray(data.records)) return;
  for (const r of data.records) {
    adapter.run(
      `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.timestamp || new Date().toISOString(), r.provider || null, r.model || null, r.connectionId || null, r.status || null, stringifyJson(r)]
    );
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────
export async function runMigrationOnce(adapter) {
  if (_migratedAdapters.has(adapter)) return;
  _migratedAdapters.add(adapter);

  // Capture freshness BEFORE migrations stamp _meta (otherwise we'd misclassify
  // a brand-new DB as non-fresh once schemaVersion is written).
  const fresh = isFreshDb(adapter);

  // Prune stale backups every boot so old oversized backups shrink to KEEP.
  pruneOldBackups();

  // Bootstrap _meta so we can read the stored backup schema version below
  // (runVersionedMigrations also ensures this, but we need it earlier here).
  adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

  // Detect a pending schema change via the central SCHEMA_VERSION const.
  // A lightweight backup is taken BEFORE any schema mutation below.
  const storedSchemaVer = parseInt(getMetaSync(adapter, "backupSchemaVersion", "0"), 10) || 0;
  const schemaChanging = !fresh && storedSchemaVer < SCHEMA_VERSION;
  if (schemaChanging) {
    try {
      const backupDir = makeBackupDir(`schema-${storedSchemaVer}-to-${SCHEMA_VERSION}`);
      await backupDbLite(adapter, backupDir);
      pruneOldBackups();
      console.log(`[DB][migrate] pre-schema backup ${storedSchemaVer} → ${SCHEMA_VERSION}: ${backupDir}`);
    } catch (e) {
      // Continue, but never silently: this DB just reached a schema change with
      // NO safety backup (T1.4 H-2 — used to be an easily-missed warn).
      console.warn(`[DB][migrate] ⚠️ WARNING pre-schema backup FAILED — applying schema change with NO safety backup (continuing): ${e.message}`);
    }
  }

  // 1. Always run versioned migrations chain (skip-version safe)
  const migInfo = runVersionedMigrations(adapter);

  // 2. Additive sync (auto add missing columns/indexes declared in TABLES)
  syncSchemaFromTables(adapter);

  // Stamp the schema version we just reached so future boots skip re-backup.
  setMetaSync(adapter, "backupSchemaVersion", SCHEMA_VERSION);

  // 3. Legacy JSON import — one-time but RETRYABLE (T1.4 H-1).
  //
  // _meta.importStatus state machine:
  //   null                → nothing recorded (fresh DB, or DB written by pre-fix code)
  //   "pending"           → import started; process died before it could be recorded
  //   "aborted"           → MigrationAborted/other error; rows fully rolled back,
  //                         reason kept in _meta (importAbortReason / importAbortedAt)
  //   "done"              → committed INSIDE the import transaction (atomic with rows)
  //   "skipped-populated" → legacy files present + DB already has data + no import
  //                         record → leave data alone; stable until operator acts
  // Anything other than "done" (and the legacy marker file) retries on next boot.
  const markerPresent = fs.existsSync(MIGRATED_MARKER);
  const legacyMain = readJsonSafe(LEGACY_FILES.main);
  const legacyUsage = readJsonSafe(LEGACY_FILES.usage);
  const legacyDisabled = readJsonSafe(LEGACY_FILES.disabled);
  const legacyDetails = readJsonSafe(LEGACY_FILES.details);
  const hasLegacy = !!(legacyMain || legacyUsage || legacyDisabled || legacyDetails);

  let importStatus = getMetaSync(adapter, "importStatus", null);

  // Normalize historical successful imports (marker-file era) into the _meta flag.
  if (markerPresent && importStatus !== "done") {
    setMetaSync(adapter, "importStatus", "done");
    importStatus = "done";
  }

  let shouldImport = false;
  if (hasLegacy && importStatus !== "done") {
    if (fresh) {
      shouldImport = true; // brand-new DB with legacy files (original behavior)
    } else if (importStatus === "pending" || importStatus === "aborted") {
      shouldImport = true; // retry an import that aborted or crashed mid-way
    } else if (importStatus !== "skipped-populated" && !dbHasImportedData(adapter)) {
      shouldImport = true; // self-heal DBs frozen by the pre-fix bug (H-1)
    }
  }
  if (!shouldImport && hasLegacy && !fresh && !markerPresent && importStatus === null) {
    // Non-fresh DB, no import record, but real data already present: typically an
    // old completed import whose marker file was lost. Re-importing would
    // duplicate usageHistory and overwrite live rows, so skip and say it loudly.
    setMetaSync(adapter, "importStatus", "skipped-populated");
    console.warn("[DB][migrate] ⚠️ WARNING legacy JSON found in DATA_DIR but the DB already contains data and no import record exists — import skipped. Remove the legacy file(s) to clear this warning (or start from an empty data dir to force the import).");
  }

  if (shouldImport) {
    // Retry/recovery runs in lenient mode (DB is no longer "fresh"): tolerate
    // duplicate-id rows collapsed by INSERT OR REPLACE and never overwrite
    // existing settings. First-ever imports stay strict.
    const lenient = !fresh;
    const attempts = (parseInt(getMetaSync(adapter, "importAttempts", "0"), 10) || 0) + 1;
    setMetaSync(adapter, "importStatus", "pending");
    setMetaSync(adapter, "importAttempts", attempts);

    const t0 = Date.now();
    let backupDir = null;
    try {
      backupDir = makeBackupDir("migrate-from-json");
      for (const f of Object.values(LEGACY_FILES)) backupFile(f, backupDir);
    } catch (e) {
      console.warn(`[DB][migrate] ⚠️ WARNING pre-import backup FAILED (continuing; legacy JSON untouched): ${e.message}`);
    }

    try {
      adapter.transaction(() => {
        importLegacyMain(adapter, legacyMain, { lenient });
        importLegacyUsage(adapter, legacyUsage);
        importLegacyDisabled(adapter, legacyDisabled);
        importLegacyDetails(adapter, legacyDetails);
        setMetaSync(adapter, "appVersion", getAppVersion());
        setMetaSync(adapter, "backupSchemaVersion", SCHEMA_VERSION);
        setMetaSync(adapter, "migratedAt", new Date().toISOString());
        // The completion flag commits in the SAME transaction as the rows:
        // data and status can never disagree (no duplicate import, no lost flag).
        setMetaSync(adapter, "importStatus", "done");
      });
    } catch (err) {
      const reason = err?.message || String(err);
      setMetaSync(adapter, "importStatus", "aborted");
      setMetaSync(adapter, "importAbortReason", reason);
      setMetaSync(adapter, "importAbortedAt", new Date().toISOString());
      if (err instanceof MigrationAborted) {
        console.error(`[DB][migrate] ⚠️ WARNING import aborted (attempt ${attempts}): ${reason} | legacy JSON kept | backup: ${backupDir} | will retry on next boot`);
        return;
      }
      throw err;
    }

    try { fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString()); } catch {}
    try { adapter.run(`DELETE FROM _meta WHERE key IN ('importAbortReason','importAbortedAt')`); } catch {}
    pruneOldBackups();
    console.log(`[DB][migrate] JSON → SQLite in ${Date.now() - t0}ms (attempt ${attempts}${lenient ? ", retry" : ""}) | legacy JSON kept at DATA_DIR | backup: ${backupDir}`);
    return;
  }

  // Track app version for informational purposes only. App version bumps no
  // longer trigger a DB backup — only real schema changes (SCHEMA_VERSION) do.
  const newVer = getAppVersion();
  const oldVer = getMetaSync(adapter, "appVersion", null);
  if (oldVer !== newVer) setMetaSync(adapter, "appVersion", newVer);
}
