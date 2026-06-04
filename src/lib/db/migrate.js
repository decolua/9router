import fs from "node:fs";
import path from "node:path";
import { LEGACY_FILES, DB_DIR, DATA_FILE } from "./paths.js";
import { TABLES, buildCreateTableSql } from "./schema.js";
import { MIGRATIONS, latestVersion } from "./migrations/index.js";
import { getMetaSync, setMetaSync } from "./helpers/metaStore.js";
import { makeBackupDir, backupFile, pruneOldBackups } from "./backup.js";
import { getAppVersion } from "./version.js";
import { stringifyJson } from "./helpers/jsonCol.js";

// Marker file: prevents re-importing legacy JSON when user wipes data.sqlite.
const MIGRATED_MARKER = path.join(DB_DIR, ".migrated-from-json");

// Track per-adapter so reusing same adapter skips re-run, but new adapter (after reset) re-runs.
const _migratedAdapters = new WeakSet();

// Thrown when row-count assertion fails. Outer transaction rolls back,
// legacy db.json kept intact, marker not written → next boot retries.
export class MigrationAborted extends Error {
  constructor(message, droppedRows) {
    super(message);
    this.name = "MigrationAborted";
    this.droppedRows = droppedRows;
  }
}

// Insert rows one-by-one, collect failures, then assert COUNT(*) matches input length.
function importWithAssertion(adapter, tableName, rows, insertFn, rowMeta) {
  const dropped = [];
  for (const row of rows) {
    try { insertFn(row); }
    catch (err) { dropped.push({ ...rowMeta(row), reason: err.message }); }
  }
  const inserted = adapter.get(`SELECT COUNT(*) as c FROM ${tableName}`)?.c ?? 0;
  if (inserted !== rows.length) {
    console.warn(`[DB][migrate] ${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}. Dropped:`, dropped);
    throw new MigrationAborted(`${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}`, dropped);
  }
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
function syncSchemaFromTables(adapter) {
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
          console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${e.message}`);
        }
      }
    }

    // Indexes (idempotent)
    for (const idx of def.indexes || []) {
      try { adapter.exec(idx); } catch {}
    }
  }
}

// ─── Legacy JSON import (one-time) ───────────────────────────────────────
function importLegacyMain(adapter, data) {
  if (!data || typeof data !== "object") return;

  if (data.settings) {
    adapter.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(data.settings)]);
  }

  importWithAssertion(adapter, "providerConnections", data.providerConnections || [], (c) => {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
    adapter.run(
      `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (c) => ({ id: c.id ?? null, provider: c.provider ?? null, name: c.name ?? null }));

  importWithAssertion(adapter, "providerNodes", data.providerNodes || [], (n) => {
    const { id, type, name, createdAt, updatedAt, ...rest } = n;
    adapter.run(
      `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (n) => ({ id: n.id ?? null, type: n.type ?? null, name: n.name ?? null }));

  importWithAssertion(adapter, "proxyPools", data.proxyPools || [], (p) => {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
    adapter.run(
      `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (p) => ({ id: p.id ?? null }));

  importWithAssertion(adapter, "apiKeys", data.apiKeys || [], (k) => {
    adapter.run(
      `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
    );
  }, (k) => ({ id: k.id ?? null, name: k.name ?? null }));

  importWithAssertion(adapter, "combos", data.combos || [], (c) => {
    adapter.run(
      `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
    );
  }, (c) => ({ id: c.id ?? null, name: c.name ?? null }));

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

  // 1. Always run versioned migrations chain (skip-version safe)
  const migInfo = runVersionedMigrations(adapter);

  // 2. Additive sync (auto add missing columns/indexes declared in TABLES)
  syncSchemaFromTables(adapter);

  // 3. One-time legacy JSON import (only if DB was fresh on entry)
  const alreadyImported = fs.existsSync(MIGRATED_MARKER);
  const legacyMain = readJsonSafe(LEGACY_FILES.main);
  const legacyUsage = readJsonSafe(LEGACY_FILES.usage);
  const legacyDisabled = readJsonSafe(LEGACY_FILES.disabled);
  const legacyDetails = readJsonSafe(LEGACY_FILES.details);
  const hasLegacy = !!(legacyMain || legacyUsage || legacyDisabled || legacyDetails);

  if (fresh && hasLegacy && !alreadyImported) {
    const t0 = Date.now();
    const backupDir = makeBackupDir("migrate-from-json");
    for (const f of Object.values(LEGACY_FILES)) backupFile(f, backupDir);

    try {
      adapter.transaction(() => {
        importLegacyMain(adapter, legacyMain);
        importLegacyUsage(adapter, legacyUsage);
        importLegacyDisabled(adapter, legacyDisabled);
        importLegacyDetails(adapter, legacyDetails);
        setMetaSync(adapter, "appVersion", getAppVersion());
        setMetaSync(adapter, "migratedAt", new Date().toISOString());
      });
    } catch (err) {
      if (err instanceof MigrationAborted) {
        console.error(`[DB][migrate] aborted: ${err.message} | legacy JSON kept | backup: ${backupDir}`);
        return;
      }
      throw err;
    }

    try { fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString()); } catch {}
    pruneOldBackups();
    console.log(`[DB][migrate] JSON → SQLite in ${Date.now() - t0}ms | legacy JSON kept at DATA_DIR | backup: ${backupDir}`);
    return;
  }

  if (fresh) {
    setMetaSync(adapter, "appVersion", getAppVersion());
    return;
  }

  // 4. App version bump → backup data.sqlite (safety net before user-side upgrade)
  const oldVer = getMetaSync(adapter, "appVersion", null);
  const newVer = getAppVersion();
  if (oldVer && oldVer !== newVer) {
    const backupDir = makeBackupDir(`upgrade-${oldVer}-to-${newVer}`);
    try { backupFile(DATA_FILE, backupDir); } catch {}
    setMetaSync(adapter, "appVersion", newVer);
    pruneOldBackups();
    console.log(`[DB][migrate] App ${oldVer} → ${newVer} | schema ${migInfo.from} → ${migInfo.to} | backup: ${backupDir}`);
  } else if (migInfo.applied > 0) {
    // Schema upgrade without app version bump — still backup
    const backupDir = makeBackupDir(`schema-${migInfo.from}-to-${migInfo.to}`);
    try { backupFile(DATA_FILE, backupDir); } catch {}
    pruneOldBackups();
  }
}
