import fs from "node:fs";
import path from "node:path";
import { LEGACY_FILES, DB_DIR, DATA_FILE } from "./paths.js";
import { TABLES, buildCreateTableSqlForDialect } from "./schema.js";
import { MIGRATIONS, latestVersion } from "./migrations/index.js";
import { getMetaWith, setMetaWith } from "./helpers/metaStore.js";
import { makeBackupDir, backupFile, pruneOldBackups } from "./backup.js";
import { getAppVersion } from "./version.js";
import { stringifyJson } from "./helpers/jsonCol.js";

const MIGRATION_BATCH_SIZE = 500;

// Marker file: prevents re-importing legacy JSON when user wipes data.sqlite.
const MIGRATED_MARKER = path.join(DB_DIR, ".migrated-from-json");

// Track per-adapter so reusing same adapter skips re-run, but new adapter (after reset) re-runs.
const _migratedAdapters = new WeakSet();

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

async function isFreshDb(adapter) {
  // Table _meta may not exist yet on truly fresh DB
  try {
    const row = await adapter.get(`SELECT COUNT(*) as c FROM _meta`);
    if (!row) return true;
    const count = parseInt(String(row.c), 10);
    return isNaN(count) || count === 0;
  } catch {
    return true;
  }
}

// ─── Versioned migrations runner (skip-version safe) ─────────────────────
async function runVersionedMigrations(adapter) {
  const dialect = adapter.dialect || "sqlite";
  // Bootstrap _meta first so we can read schemaVersion
  await adapter.exec(buildCreateTableSqlForDialect("_meta", TABLES._meta, dialect));

  const current = parseInt(await getMetaWith(adapter, "schemaVersion", "0"), 10) || 0;
  const target = latestVersion();
  if (current >= target) return { applied: 0, from: current, to: current };

  const pending = MIGRATIONS.filter((m) => m.version > current);
  let lastApplied = current;
  for (const m of pending) {
    await adapter.transaction(async () => {
      await m.up(adapter);
      await setMetaWith(adapter, "schemaVersion", m.version);
    });
    lastApplied = m.version;
    console.log(`[DB][migrate] applied #${m.version} ${m.name}`);
  }
  return { applied: pending.length, from: current, to: lastApplied };
}

// ─── Auto-sync (additive only): add missing tables/columns/indexes ───────
async function syncSchemaFromTables(adapter) {
  const dialect = adapter.dialect || "sqlite";

  for (const [tableName, def] of Object.entries(TABLES)) {
    // Create table if absent
    await adapter.exec(buildCreateTableSqlForDialect(tableName, def, dialect));

    // Diff columns (works for all dialects — adapters translate PRAGMA to info_schema)
    const existing = await adapter.all(`PRAGMA table_info(${tableName})`);
    // PG folds unquoted identifiers to lowercase; compare case-insensitively
    const existingNames = new Set(existing.map((r) => r.name.toLowerCase()));

    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName.toLowerCase())) {
        // Strip PK/UNIQUE/AUTOINCREMENT — can't add those on existing tables
        let safeDef = colDef
          .replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "")
          .replace(/\bAUTOINCREMENT\b/gi, "")
          .replace(/\bUNIQUE\b/gi, "")
          .trim();
        // Dialect adjustments for ADD COLUMN
        if (dialect === "postgresql") {
          safeDef = safeDef.replace(/\bINTEGER\b/gi, "INTEGER");
        } else if (dialect === "mysql") {
          safeDef = safeDef
            .replace(/\bINTEGER\b/gi, "INT")
            .replace(/\bREAL\b/gi, "DOUBLE")
            .replace(/\bTEXT\s+NOT\s+NULL\b/gi, "MEDIUMTEXT NOT NULL")
            .replace(/\bTEXT\b/gi, "MEDIUMTEXT");
        }
        try {
          await adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}`);
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e) {
          console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${e.message}`);
        }
      }
    }

    // Indexes (idempotent)
    for (const idx of def.indexes || []) {
      try { await adapter.exec(idx); } catch {}
    }
  }
}

// ─── Legacy JSON import (one-time, SQLite only) ───────────────────────────
async function importLegacyMain(adapter, data) {
  if (!data || typeof data !== "object") return;

  if (data.settings) {
    await adapter.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(data.settings)]);
  }
  for (const c of data.providerConnections || []) {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
    await adapter.run(
      `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }
  for (const n of data.providerNodes || []) {
    const { id, type, name, createdAt, updatedAt, ...rest } = n;
    await adapter.run(
      `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }
  for (const p of data.proxyPools || []) {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
    await adapter.run(
      `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }
  for (const k of data.apiKeys || []) {
    await adapter.run(
      `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
    );
  }
  for (const c of data.combos || []) {
    await adapter.run(
      `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
    );
  }
  for (const [alias, model] of Object.entries(data.modelAliases || {})) {
    await adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [alias, stringifyJson(model)]);
  }
  for (const m of data.customModels || []) {
    const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
    await adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
  }
  for (const [tool, mappings] of Object.entries(data.mitmAlias || {})) {
    await adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
  }
  for (const [provider, models] of Object.entries(data.pricing || {})) {
    await adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
  }
}

async function importLegacyUsage(adapter, data) {
  if (!data || typeof data !== "object") return;
  for (const e of data.history || []) {
    const t = e.tokens || {};
    await adapter.run(
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
    await adapter.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, stringifyJson(day)]);
  }
  if (typeof data.totalRequestsLifetime === "number") {
    await setMetaWith(adapter, "totalRequestsLifetime", data.totalRequestsLifetime);
  }
}

async function importLegacyDisabled(adapter, data) {
  if (!data || typeof data.disabled !== "object") return;
  for (const [provider, ids] of Object.entries(data.disabled)) {
    await adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('disabledModels', ?, ?)`, [provider, stringifyJson(ids || [])]);
  }
}

async function importLegacyDetails(adapter, data) {
  if (!data || !Array.isArray(data.records)) return;
  for (const r of data.records) {
    await adapter.run(
      `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.timestamp || new Date().toISOString(), r.provider || null, r.model || null, r.connectionId || null, r.status || null, stringifyJson(r)]
    );
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────
export async function runMigrationOnce(adapter) {
  if (_migratedAdapters.has(adapter)) return;
  _migratedAdapters.add(adapter);

  const isRemote = adapter.dialect !== "sqlite";

  // Capture freshness BEFORE migrations stamp _meta
  const fresh = await isFreshDb(adapter);

  // 1. Always run versioned migrations chain (skip-version safe)
  const migInfo = await runVersionedMigrations(adapter);

  // 2. Additive sync (auto add missing columns/indexes declared in TABLES)
  await syncSchemaFromTables(adapter);

  // 3. One-time legacy JSON import (SQLite only)
  if (!isRemote) {
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

      await adapter.transaction(async () => {
        await importLegacyMain(adapter, legacyMain);
        await importLegacyUsage(adapter, legacyUsage);
        await importLegacyDisabled(adapter, legacyDisabled);
        await importLegacyDetails(adapter, legacyDetails);
        await setMetaWith(adapter, "appVersion", getAppVersion());
        await setMetaWith(adapter, "migratedAt", new Date().toISOString());
      });

      try { fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString()); } catch {}
      pruneOldBackups();
      console.log(`[DB][migrate] JSON → SQLite in ${Date.now() - t0}ms | legacy JSON kept at DATA_DIR | backup: ${backupDir}`);
      return;
    }
  }

  if (fresh) {
    await setMetaWith(adapter, "appVersion", getAppVersion());
    return;
  }

  // 4. App version bump → backup data.sqlite (SQLite only)

  const oldVer = await getMetaWith(adapter, "appVersion", null);
  const newVer = getAppVersion();
  if (oldVer && oldVer !== newVer) {
    if (!isRemote) {
      const backupDir = makeBackupDir(`upgrade-${oldVer}-to-${newVer}`);
      try { backupFile(DATA_FILE, backupDir); } catch {}
      pruneOldBackups();
      console.log(`[DB][migrate] App ${oldVer} → ${newVer} | schema ${migInfo.from} → ${migInfo.to} | backup: ${backupDir}`);
    }
    await setMetaWith(adapter, "appVersion", newVer);
  } else if (migInfo.applied > 0 && !isRemote) {
    const backupDir = makeBackupDir(`schema-${migInfo.from}-to-${migInfo.to}`);
    try { backupFile(DATA_FILE, backupDir); } catch {}
    pruneOldBackups();
  }
}

// Returns true if any user-data table has rows (excludes _meta which migrations populate)
async function hasUserData(adapter) {
  try {
    for (const table of ["providerConnections", "providerNodes", "combos", "kv"]) {
      const row = await adapter.get(`SELECT 1 FROM ${table} LIMIT 1`);
      if (row) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── One-time SQLite → remote copy ───────────────────────────────────────
export async function migrateFromLocalSqlite(localAdapter, remoteAdapter) {
  const marker = await getMetaWith(remoteAdapter, "migratedFromLocal", null);
  // Only respect a real ISO timestamp (successful migration); ignore stale "skipped:*" values
  if (marker && /^\d{4}-\d{2}-\d{2}T/.test(marker)) return false;

  // Remote must have no user data (only schema + _meta from migrations is OK)
  if (await hasUserData(remoteAdapter)) return false;

  // Local must have user data worth migrating
  if (!(await hasUserData(localAdapter))) return false;

  console.log("[DB][migrate] SQLite → remote: starting data copy...");
  const t0 = Date.now();

  // Phase 1: all tables except usageHistory (single transaction)
  await remoteAdapter.transaction(async () => {
    for (const row of await localAdapter.all(`SELECT id, data FROM settings`)) {
      await remoteAdapter.run(
        `INSERT INTO settings(id, data) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
        [row.id, row.data]
      );
    }
    for (const row of await localAdapter.all(`SELECT * FROM providerConnections`)) {
      await remoteAdapter.run(
        `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, authType=excluded.authType, name=excluded.name, email=excluded.email, priority=excluded.priority, isActive=excluded.isActive, data=excluded.data, updatedAt=excluded.updatedAt`,
        [row.id, row.provider, row.authType, row.name, row.email, row.priority, row.isActive, row.data, row.createdAt, row.updatedAt]
      );
    }
    for (const row of await localAdapter.all(`SELECT * FROM providerNodes`)) {
      await remoteAdapter.run(
        `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
        [row.id, row.type, row.name, row.data, row.createdAt, row.updatedAt]
      );
    }
    for (const row of await localAdapter.all(`SELECT * FROM proxyPools`)) {
      await remoteAdapter.run(
        `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET isActive=excluded.isActive, testStatus=excluded.testStatus, data=excluded.data, updatedAt=excluded.updatedAt`,
        [row.id, row.isActive, row.testStatus, row.data, row.createdAt, row.updatedAt]
      );
    }
    for (const row of await localAdapter.all(`SELECT * FROM apiKeys`)) {
      await remoteAdapter.run(
        `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET key=excluded.key, name=excluded.name, machineId=excluded.machineId, isActive=excluded.isActive`,
        [row.id, row.key, row.name, row.machineId, row.isActive, row.createdAt]
      );
    }
    for (const row of await localAdapter.all(`SELECT * FROM combos`)) {
      await remoteAdapter.run(
        `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, models=excluded.models, updatedAt=excluded.updatedAt`,
        [row.id, row.name, row.kind, row.models, row.createdAt, row.updatedAt]
      );
    }
    for (const row of await localAdapter.all(`SELECT scope, key, value FROM kv`)) {
      await remoteAdapter.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value=excluded.value`,
        [row.scope, row.key, row.value]
      );
    }
    for (const row of await localAdapter.all(`SELECT dateKey, data FROM usageDaily`)) {
      await remoteAdapter.run(
        `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data=excluded.data`,
        [row.dateKey, row.data]
      );
    }
    for (const row of await localAdapter.all(`SELECT * FROM requestDetails`)) {
      await remoteAdapter.run(
        `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp=excluded.timestamp, status=excluded.status, data=excluded.data`,
        [row.id, row.timestamp, row.provider, row.model, row.connectionId, row.status, row.data]
      );
    }
    // _meta: skip schemaVersion/appVersion (already stamped by runMigrationOnce)
    for (const row of await localAdapter.all(`SELECT key, value FROM _meta WHERE key NOT IN ('schemaVersion', 'appVersion')`)) {
      await remoteAdapter.run(
        `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [row.key, row.value]
      );
    }
  });

  // Phase 2: usageHistory in batches (cursor-based; resumable after partial failure)
  // lastCopiedSourceId is persisted after each batch so a retry skips already-copied rows.
  const wmRow = await getMetaWith(remoteAdapter, "migratedFromLocalUsageId", null);
  let lastCopiedSourceId = wmRow ? parseInt(wmRow, 10) : 0;

  const countRow = await localAdapter.get(`SELECT COUNT(*) as c FROM usageHistory WHERE id > ?`, [lastCopiedSourceId]);
  const total = countRow ? parseInt(String(countRow.c), 10) : 0;
  let copied = 0;

  while (copied < total) {
    const batch = await localAdapter.all(
      `SELECT id, timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta FROM usageHistory WHERE id > ? ORDER BY id ASC LIMIT ?`,
      [lastCopiedSourceId, MIGRATION_BATCH_SIZE]
    );
    if (!batch.length) break;
    await remoteAdapter.transaction(async () => {
      for (const row of batch) {
        await remoteAdapter.run(
          `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.timestamp, row.provider, row.model, row.connectionId, row.apiKey, row.endpoint, row.promptTokens, row.completionTokens, row.cost, row.status, row.tokens, row.meta]
        );
      }
    });
    lastCopiedSourceId = batch[batch.length - 1].id;
    await setMetaWith(remoteAdapter, "migratedFromLocalUsageId", String(lastCopiedSourceId));
    copied += batch.length;
    if (total > MIGRATION_BATCH_SIZE) {
      process.stdout.write(`\r[DB][migrate] usageHistory: ${copied}/${total}`);
    }
  }
  if (total > MIGRATION_BATCH_SIZE) process.stdout.write("\n");

  await setMetaWith(remoteAdapter, "migratedFromLocal", new Date().toISOString());
  console.log(`[DB][migrate] SQLite → remote: done in ${Date.now() - t0}ms (${total} usage rows)`);
  return true;
}
