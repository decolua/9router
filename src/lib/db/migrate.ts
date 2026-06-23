import fs from "node:fs";
import path from "node:path";
import type { DbAdapter } from "./driver.js";
import { LEGACY_FILES, DB_DIR, DATA_FILE } from "./paths.js";
import { normalizeApiKeyUsageId, normalizeUsageDailySummary } from "./helpers/apiKeyUsageId.js";
import { TABLES, buildCreateTableSql } from "./schema.js";
import { MIGRATIONS, latestVersion } from "./migrations/index.js";
import { getMetaSync, setMetaSync } from "./helpers/metaStore.js";
import { makeBackupDir, backupFile, pruneOldBackups } from "./backup.js";
import { getAppVersion } from "./version.js";
import type { JsonValue } from "open-sse/types/executor.js";
import { stringifyJson } from "./helpers/jsonCol.js";

// Marker file: prevents re-importing legacy JSON when user wipes data.sqlite.
const MIGRATED_MARKER = path.join(DB_DIR, ".migrated-from-json");

// Track per-adapter so reusing same adapter skips re-run, but new adapter (after reset) re-runs.
const _migratedAdapters = new WeakSet<DbAdapter>();

// Thrown when row-count assertion fails. Outer transaction rolls back,
// legacy db.json kept intact, marker not written → next boot retries.
export class MigrationAborted extends Error {
  droppedRows: unknown[];
  constructor(message: string, droppedRows: unknown[]) {
    super(message);
    this.name = "MigrationAborted";
    this.droppedRows = droppedRows;
  }
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function strField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function numField(obj: Record<string, unknown>, key: string, fallback = 0): number {
  const v = obj[key];
  return typeof v === "number" ? v : fallback;
}

// Insert rows one-by-one, collect failures, then assert COUNT(*) matches input length.
function importWithAssertion(
  adapter: DbAdapter,
  tableName: string,
  rows: unknown[],
  insertFn: (row: Record<string, unknown>) => void,
  rowMeta: (row: Record<string, unknown>) => Record<string, unknown>,
) {
  const dropped: Record<string, unknown>[] = [];
  for (const raw of rows) {
    const row = asObj(raw) ?? {};
    try { insertFn(row); }
    catch (err) { dropped.push({ ...rowMeta(row), reason: (err as Error).message }); }
  }
  const result = adapter.get(`SELECT COUNT(*) as c FROM ${tableName}`);
  const inserted = result && "c" in result && typeof result["c"] === "number" ? result["c"] : 0;
  if (inserted !== rows.length) {
    console.warn(
      `[DB][migrate] ${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}. Dropped:`,
      dropped,
    );
    throw new MigrationAborted(
      `${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}`,
      dropped,
    );
  }
}

function readJsonSafe(file: string): unknown {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

function isFreshDb(adapter: DbAdapter) {
  try {
    const row = adapter.get(`SELECT COUNT(*) as c FROM _meta`);
    const c = row && "c" in row && typeof row["c"] === "number" ? row["c"] : 0;
    return c === 0;
  } catch {
    return true;
  }
}

// ─── Versioned migrations runner (skip-version safe) ─────────────────────
function runVersionedMigrations(adapter: DbAdapter) {
  adapter.exec(buildCreateTableSql("_meta", TABLES["_meta"]!));

  const current = parseInt(getMetaSync(adapter, "schemaVersion", "0") ?? "0", 10) || 0;
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
function syncSchemaFromTables(adapter: DbAdapter) {
  for (const [tableName, def] of Object.entries(TABLES)) {
    adapter.exec(buildCreateTableSql(tableName, def));

    const existing = adapter.all(`PRAGMA table_info(${tableName})`);
    const existingNames = new Set<string>();
    for (const r of existing) {
      if ("name" in r && typeof r["name"] === "string") existingNames.add(r["name"]);
    }

    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName)) {
        const safeDef = colDef
          .replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "")
          .replace(/UNIQUE/i, "")
          .trim();
        try {
          adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}`);
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e) {
          console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${(e as Error).message}`);
        }
      }
    }

    for (const idx of def.indexes ?? []) {
      try { adapter.exec(idx); } catch {}
    }
  }
}

// ─── Legacy JSON import (one-time) ───────────────────────────────────────
function importLegacyMain(adapter: DbAdapter, data: unknown) {
  const d = asObj(data);
  if (!d) return;

  if (d["settings"]) {
    adapter.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(d["settings"] as JsonValue)],
    );
  }

  importWithAssertion(
    adapter, "providerConnections", asArr(d["providerConnections"]),
    (c) => {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      adapter.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType ?? "oauth", name ?? null, email ?? null, priority ?? null, isActive === false ? 0 : 1, stringifyJson(rest as JsonValue), createdAt ?? new Date().toISOString(), updatedAt ?? new Date().toISOString()],
      );
    },
    (c) => ({ id: c["id"] ?? null, provider: c["provider"] ?? null, name: c["name"] ?? null }),
  );

  importWithAssertion(
    adapter, "providerNodes", asArr(d["providerNodes"]),
    (n) => {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      adapter.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type ?? null, name ?? null, stringifyJson(rest as JsonValue), createdAt ?? new Date().toISOString(), updatedAt ?? new Date().toISOString()],
      );
    },
    (n) => ({ id: n["id"] ?? null, type: n["type"] ?? null, name: n["name"] ?? null }),
  );

  importWithAssertion(
    adapter, "proxyPools", asArr(d["proxyPools"]),
    (p) => {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      adapter.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus ?? "unknown", stringifyJson(rest as JsonValue), createdAt ?? new Date().toISOString(), updatedAt ?? new Date().toISOString()],
      );
    },
    (p) => ({ id: p["id"] ?? null }),
  );

  importWithAssertion(
    adapter, "apiKeys", asArr(d["apiKeys"]),
    (k) => {
      adapter.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [k["id"], k["key"], k["name"] ?? null, k["machineId"] ?? null, k["isActive"] === false ? 0 : 1, k["createdAt"] ?? new Date().toISOString()],
      );
    },
    (k) => ({ id: k["id"] ?? null, name: k["name"] ?? null }),
  );

  importWithAssertion(
    adapter, "combos", asArr(d["combos"]),
    (c) => {
      adapter.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c["id"], c["name"], c["kind"] ?? null, stringifyJson((c["models"] ?? []) as JsonValue), c["createdAt"] ?? new Date().toISOString(), c["updatedAt"] ?? new Date().toISOString()],
      );
    },
    (c) => ({ id: c["id"] ?? null, name: c["name"] ?? null }),
  );

  const modelAliases = asObj(d["modelAliases"]) ?? {};
  for (const [alias, model] of Object.entries(modelAliases)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [alias, stringifyJson(model as JsonValue)]);
  }
  for (const raw of asArr(d["customModels"])) {
    const m = asObj(raw) ?? {};
    const k = `${m["providerAlias"]}|${m["id"]}|${m["type"] ?? "llm"}`;
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m as JsonValue)]);
  }
  const mitmAlias = asObj(d["mitmAlias"]) ?? {};
  for (const [tool, mappings] of Object.entries(mitmAlias)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson((mappings ?? {}) as JsonValue)]);
  }
  const pricing = asObj(d["pricing"]) ?? {};
  for (const [provider, models] of Object.entries(pricing)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson((models ?? {}) as JsonValue)]);
  }
}

function importLegacyUsage(adapter: DbAdapter, data: unknown) {
  const d = asObj(data);
  if (!d) return;
  for (const raw of asArr(d["history"])) {
    const e = asObj(raw) ?? {};
    const t = asObj(e["tokens"]) ?? {};
    adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        strField(e, "timestamp") ?? new Date().toISOString(),
        strField(e, "provider"), strField(e, "model"), strField(e, "connectionId"),
        normalizeApiKeyUsageId(strField(e, "apiKey")),
        strField(e, "endpoint"),
        numField(t, "prompt_tokens") || numField(t, "input_tokens"),
        numField(t, "completion_tokens") || numField(t, "output_tokens"),
        numField(e, "cost"),
        strField(e, "status") ?? "ok",
        stringifyJson(t as JsonValue),
        stringifyJson({}),
      ],
    );
  }
  const dailySummary = asObj(d["dailySummary"]) ?? {};
  for (const [dateKey, day] of Object.entries(dailySummary)) {
    adapter.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, stringifyJson(normalizeUsageDailySummary(day) as JsonValue)]);
  }
  const lifetime = d["totalRequestsLifetime"];
  if (typeof lifetime === "number") {
    setMetaSync(adapter, "totalRequestsLifetime", lifetime);
  }
}

function importLegacyDisabled(adapter: DbAdapter, data: unknown) {
  const d = asObj(data);
  if (!d) return;
  const disabled = asObj(d["disabled"]);
  if (!disabled) return;
  for (const [provider, ids] of Object.entries(disabled)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('disabledModels', ?, ?)`, [provider, stringifyJson((ids ?? []) as JsonValue)]);
  }
}

function importLegacyDetails(adapter: DbAdapter, data: unknown) {
  const d = asObj(data);
  if (!d || !Array.isArray(d["records"])) return;
  for (const raw of d["records"] as unknown[]) {
    const r = asObj(raw) ?? {};
    adapter.run(
      `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [r["id"], r["timestamp"] ?? new Date().toISOString(), r["provider"] ?? null, r["model"] ?? null, r["connectionId"] ?? null, r["status"] ?? null, stringifyJson(r as JsonValue)],
    );
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────
export async function runMigrationOnce(adapter: DbAdapter) {
  if (_migratedAdapters.has(adapter)) return;
  _migratedAdapters.add(adapter);

  const fresh = isFreshDb(adapter);
  const migInfo = runVersionedMigrations(adapter);
  syncSchemaFromTables(adapter);

  const alreadyImported = fs.existsSync(MIGRATED_MARKER);
  const legacyMain = readJsonSafe(LEGACY_FILES["main"]!);
  const legacyUsage = readJsonSafe(LEGACY_FILES["usage"]!);
  const legacyDisabled = readJsonSafe(LEGACY_FILES["disabled"]!);
  const legacyDetails = readJsonSafe(LEGACY_FILES["details"]!);
  const hasLegacy = !!(legacyMain ?? legacyUsage ?? legacyDisabled ?? legacyDetails);

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

  const oldVer = getMetaSync(adapter, "appVersion", null);
  const newVer = getAppVersion();
  if (oldVer && oldVer !== newVer) {
    const backupDir = makeBackupDir(`upgrade-${oldVer}-to-${newVer}`);
    try { backupFile(DATA_FILE, backupDir); } catch {}
    setMetaSync(adapter, "appVersion", newVer);
    pruneOldBackups();
    console.log(`[DB][migrate] App ${oldVer} → ${newVer} | schema ${migInfo.from} → ${migInfo.to} | backup: ${backupDir}`);
  } else if (migInfo.applied > 0) {
    const backupDir = makeBackupDir(`schema-${migInfo.from}-to-${migInfo.to}`);
    try { backupFile(DATA_FILE, backupDir); } catch {}
    pruneOldBackups();
  }
}
