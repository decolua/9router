import fs from "node:fs";
import path from "node:path";
import { LEGACY_FILES, DB_DIR } from "./paths.js";
import { TABLES, buildCreateTableSql, toPgColumnDef, SCHEMA_VERSION } from "./schema.js";
import { MIGRATIONS, latestVersion } from "./migrations/index.js";
import { getMetaWith, setMetaWith } from "./helpers/metaStore.js";
import { makeBackupDir, backupFile, backupDbLite, pruneOldBackups } from "./backup.js";
import { getAppVersion } from "./version.js";
import { stringifyJson } from "./helpers/jsonCol.js";
import { upsertSql } from "./helpers/upsert.js";

// Marker file: prevents re-importing legacy JSON when user wipes the database.
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
async function importWithAssertion(adapter, tableName, rows, insertFn, rowMeta) {
  const dropped = [];
  for (const row of rows) {
    try { await insertFn(row); }
    catch (err) { dropped.push({ ...rowMeta(row), reason: err.message }); }
  }
  const inserted = (await adapter.get(`SELECT COUNT(*) as c FROM ${tableName}`))?.c ?? 0;
  if (inserted !== rows.length) {
    console.warn(`[DB][migrate] ${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}. Dropped:`, dropped);
    throw new MigrationAborted(`${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}`, dropped);
  }
}

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

async function isFreshDb(adapter) {
  // Table _meta may not exist yet on truly fresh DB
  try {
    const row = await adapter.get(`SELECT COUNT(*) as c FROM _meta`);
    return !row || row.c === 0;
  } catch {
    return true;
  }
}

// ─── Versioned migrations runner (skip-version safe) ─────────────────────
async function runVersionedMigrations(adapter) {
  // Bootstrap _meta first so we can read schemaVersion
  await adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

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
  for (const [tableName, def] of Object.entries(TABLES)) {
    // Create table if absent
    await adapter.exec(buildCreateTableSql(tableName, def));

    // Diff columns via information_schema (Postgres folds identifiers to lower-case)
    const existing = await adapter.all(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ?`,
      [tableName.toLowerCase()],
    );
    const existingNames = new Set(existing.map((r) => String(r.name).toLowerCase()));
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName.toLowerCase())) {
        // PRIMARY KEY / UNIQUE are only valid at create time for ADD COLUMN here.
        const safeDef = toPgColumnDef(
          colDef
            .replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "")
            .replace(/UNIQUE/i, "")
            .trim(),
        );
        try {
          await adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${colName} ${safeDef}`);
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e) {
          console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${e.message}`);
        }
      }
    }

    // Indexes (idempotent — all declared with IF NOT EXISTS)
    for (const idx of def.indexes || []) {
      try { await adapter.exec(idx); } catch { /* already exists */ }
    }
  }
}

// ─── Legacy JSON import (one-time) ───────────────────────────────────────
async function importLegacyMain(adapter, data) {
  if (!data || typeof data !== "object") return;

  if (data.settings) {
    await adapter.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(data.settings)]);
  }

  const connCols = ["id", "provider", "authType", "name", "email", "priority", "isActive", "data", "createdAt", "updatedAt"];
  await importWithAssertion(adapter, "providerConnections", data.providerConnections || [], (c) => {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
    return adapter.run(
      upsertSql("providerConnections", connCols, ["id"]),
      [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()],
    );
  }, (c) => ({ id: c.id ?? null, provider: c.provider ?? null, name: c.name ?? null }));

  const nodeCols = ["id", "type", "name", "data", "createdAt", "updatedAt"];
  await importWithAssertion(adapter, "providerNodes", data.providerNodes || [], (n) => {
    const { id, type, name, createdAt, updatedAt, ...rest } = n;
    return adapter.run(
      upsertSql("providerNodes", nodeCols, ["id"]),
      [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()],
    );
  }, (n) => ({ id: n.id ?? null, type: n.type ?? null, name: n.name ?? null }));

  const poolCols = ["id", "isActive", "testStatus", "data", "createdAt", "updatedAt"];
  await importWithAssertion(adapter, "proxyPools", data.proxyPools || [], (p) => {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
    return adapter.run(
      upsertSql("proxyPools", poolCols, ["id"]),
      [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()],
    );
  }, (p) => ({ id: p.id ?? null }));

  const keyCols = ["id", "key", "name", "machineId", "isActive", "createdAt"];
  await importWithAssertion(adapter, "apiKeys", data.apiKeys || [], (k) => adapter.run(
    upsertSql("apiKeys", keyCols, ["id"]),
    [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()],
  ), (k) => ({ id: k.id ?? null, name: k.name ?? null }));

  const comboCols = ["id", "name", "kind", "models", "createdAt", "updatedAt"];
  await importWithAssertion(adapter, "combos", data.combos || [], (c) => adapter.run(
    upsertSql("combos", comboCols, ["id"]),
    [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()],
  ), (c) => ({ id: c.id ?? null, name: c.name ?? null }));

  const kvUpsert = upsertSql("kv", ["scope", "key", "value"], ["scope", "key"]);
  for (const [alias, model] of Object.entries(data.modelAliases || {})) {
    await adapter.run(kvUpsert, ["modelAliases", alias, stringifyJson(model)]);
  }
  for (const m of data.customModels || []) {
    const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
    await adapter.run(kvUpsert, ["customModels", k, stringifyJson(m)]);
  }
  for (const [tool, mappings] of Object.entries(data.mitmAlias || {})) {
    await adapter.run(kvUpsert, ["mitmAlias", tool, stringifyJson(mappings || {})]);
  }
  for (const [provider, models] of Object.entries(data.pricing || {})) {
    await adapter.run(kvUpsert, ["pricing", provider, stringifyJson(models || {})]);
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
      ],
    );
  }
  const dailyUpsert = upsertSql("usageDaily", ["dateKey", "data"], ["dateKey"]);
  for (const [dateKey, day] of Object.entries(data.dailySummary || {})) {
    await adapter.run(dailyUpsert, [dateKey, stringifyJson(day)]);
  }
  if (typeof data.totalRequestsLifetime === "number") {
    await setMetaWith(adapter, "totalRequestsLifetime", data.totalRequestsLifetime);
  }
}

async function importLegacyDisabled(adapter, data) {
  if (!data || typeof data.disabled !== "object") return;
  const kvUpsert = upsertSql("kv", ["scope", "key", "value"], ["scope", "key"]);
  for (const [provider, ids] of Object.entries(data.disabled)) {
    await adapter.run(kvUpsert, ["disabledModels", provider, stringifyJson(ids || [])]);
  }
}

async function importLegacyDetails(adapter, data) {
  if (!data || !Array.isArray(data.records)) return;
  const cols = ["id", "timestamp", "provider", "model", "connectionId", "status", "data"];
  const rdUpsert = upsertSql("requestDetails", cols, ["id"]);
  for (const r of data.records) {
    await adapter.run(rdUpsert, [r.id, r.timestamp || new Date().toISOString(), r.provider || null, r.model || null, r.connectionId || null, r.status || null, stringifyJson(r)]);
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────
export async function runMigrationOnce(adapter) {
  if (_migratedAdapters.has(adapter)) return;
  _migratedAdapters.add(adapter);

  // Capture freshness BEFORE migrations stamp _meta.
  const fresh = await isFreshDb(adapter);

  pruneOldBackups();

  await adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

  const storedSchemaVer = parseInt(await getMetaWith(adapter, "backupSchemaVersion", "0"), 10) || 0;
  const schemaChanging = !fresh && storedSchemaVer < SCHEMA_VERSION;
  if (schemaChanging) {
    try {
      const backupDir = makeBackupDir(`schema-${storedSchemaVer}-to-${SCHEMA_VERSION}`);
      await backupDbLite(adapter, backupDir);
      pruneOldBackups();
      console.log(`[DB][migrate] pre-schema backup ${storedSchemaVer} → ${SCHEMA_VERSION}: ${backupDir}`);
    } catch (e) {
      console.warn(`[DB][migrate] pre-schema backup failed (continuing): ${e.message}`);
    }
  }

  // 1. Versioned migrations chain (skip-version safe)
  await runVersionedMigrations(adapter);

  // 2. Additive sync (auto add missing columns/indexes declared in TABLES)
  await syncSchemaFromTables(adapter);

  await setMetaWith(adapter, "backupSchemaVersion", SCHEMA_VERSION);

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
      await adapter.transaction(async () => {
        await importLegacyMain(adapter, legacyMain);
        await importLegacyUsage(adapter, legacyUsage);
        await importLegacyDisabled(adapter, legacyDisabled);
        await importLegacyDetails(adapter, legacyDetails);
        await setMetaWith(adapter, "appVersion", getAppVersion());
        await setMetaWith(adapter, "backupSchemaVersion", SCHEMA_VERSION);
        await setMetaWith(adapter, "migratedAt", new Date().toISOString());
      });
    } catch (err) {
      if (err instanceof MigrationAborted) {
        console.error(`[DB][migrate] aborted: ${err.message} | legacy JSON kept | backup: ${backupDir}`);
        return;
      }
      throw err;
    }

    try { fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString()); } catch { /* best effort */ }
    pruneOldBackups();
    console.log(`[DB][migrate] JSON → Postgres in ${Date.now() - t0}ms | legacy JSON kept at DATA_DIR | backup: ${backupDir}`);
    return;
  }

  const newVer = getAppVersion();
  const oldVer = await getMetaWith(adapter, "appVersion", null);
  if (oldVer !== newVer) await setMetaWith(adapter, "appVersion", newVer);
}
