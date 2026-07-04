// PostgreSQL migration path (async). SQLite uses migrate.js (sync).
import fs from "node:fs";
import path from "node:path";
import { qAll, qGet, qRun, qExec, qTransaction } from "./query.js";
import { LEGACY_FILES, DB_DIR } from "./paths.js";
import { TABLES, buildCreateTableSql } from "./schema.js";
import { latestVersion } from "./migrations/index.js";
import { encryptSecretsPostgres } from "./migrations/002-encrypt-secrets.js";
import { multiUserPostgres } from "./migrations/003-multi-user.js";
import { repairPostgresUserSchema } from "./migrations/004-fix-pg-user-columns.js";
import { auditLogPostgres } from "./migrations/005-audit-log.js";
import { securityExtensionsPostgres } from "./migrations/006-security-extensions.js";
import { stringifyJson } from "./helpers/jsonCol.js";
import { mapColumnDef } from "./schema.js";
import { isMasterKeyConfigured, getKeyFingerprint } from "../crypto/masterKey.js";

const MIGRATED_MARKER = path.join(DB_DIR, ".migrated-from-json");

async function getMeta(adapter, key, fallback = null) {
  const row = await qGet(adapter, `SELECT value FROM _meta WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}

async function setMeta(adapter, key, value) {
  await qRun(
    adapter,
    `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  );
}

async function verifyMasterKeyAgainstStored(adapter) {
  const stored = await getMeta(adapter, "masterKeyFingerprint", null);
  if (stored && !isMasterKeyConfigured()) {
    throw new Error(
      "[DB][boot] Encrypted data exists in this database (masterKeyFingerprint stamped) but MASTER_KEY is not set. " +
      "Set MASTER_KEY to the same value used previously, or restore an earlier backup. Refusing to start."
    );
  }
  if (stored && isMasterKeyConfigured()) {
    const current = getKeyFingerprint();
    if (current !== stored) {
      throw new Error(
        `[DB][boot] MASTER_KEY mismatch: stored fingerprint ${stored.slice(0, 8)}… does not match current ${current.slice(0, 8)}…. ` +
        "Encrypted data cannot be read with this key. Restore the correct MASTER_KEY or run the rotation tool. Refusing to start."
      );
    }
    return;
  }
  if (!stored && isMasterKeyConfigured()) {
    await setMeta(adapter, "masterKeyFingerprint", getKeyFingerprint());
  }
}

async function isFreshDb(adapter) {
  try {
    const row = await qGet(adapter, `SELECT COUNT(*)::int as c FROM _meta`);
    return !row || row.c === 0;
  } catch {
    return true;
  }
}

async function bootstrapInitialSchema(adapter) {
  for (const [name, def] of Object.entries(TABLES)) {
    await qExec(adapter, buildCreateTableSql(name, def, "postgres"));
    for (const idx of def.indexes || []) {
      const pgIdx = idx.replace(/ ON (\w+)\(/g, (m, table) => ` ON "${table}"(`);
      try { await qExec(adapter, pgIdx); } catch {}
    }
  }
}

async function syncSchemaFromTables(adapter) {
  for (const [tableName, def] of Object.entries(TABLES)) {
    await qExec(adapter, buildCreateTableSql(tableName, def, "postgres"));
    const existing = await qAll(
      adapter,
      `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
      [tableName]
    );
    const existingNames = new Set(existing.map((r) => r.name));
    const existingLower = new Set(existing.map((r) => r.name.toLowerCase()));
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName) && !existingLower.has(colName.toLowerCase())) {
        const safeDef = mapColumnDef(
          colDef
            .replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "")
            .replace(/UNIQUE/i, "")
            .trim(),
          "postgres"
        );
        try {
          await qExec(adapter, `ALTER TABLE "${tableName}" ADD COLUMN "${colName}" ${safeDef}`);
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e) {
          console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${e.message}`);
        }
      }
    }
    for (const idx of def.indexes || []) {
      const pgIdx = idx.replace(/ ON (\w+)\(/g, (_, table) => ` ON "${table}"(`);
      try { await qExec(adapter, pgIdx); } catch {}
    }
  }
}

async function runVersionedMigrations(adapter) {
  await qExec(adapter, buildCreateTableSql("_meta", TABLES._meta, "postgres"));
  const current = parseInt(await getMeta(adapter, "schemaVersion", "0"), 10) || 0;
  const target = latestVersion();
  if (current >= target) return { applied: 0, from: current, to: current };

  let lastApplied = current;
  if (current < 1) {
    await bootstrapInitialSchema(adapter);
    await setMeta(adapter, "schemaVersion", 1);
    lastApplied = 1;
    console.log("[DB][migrate] applied #1 initial");
  }
  if (lastApplied < 2) {
    await encryptSecretsPostgres(adapter);
    await setMeta(adapter, "schemaVersion", 2);
    lastApplied = 2;
    console.log("[DB][migrate] applied #2 encrypt-secrets");
  }
  if (lastApplied < 3) {
    await multiUserPostgres(adapter);
    await setMeta(adapter, "schemaVersion", 3);
    lastApplied = 3;
    console.log("[DB][migrate] applied #3 multi-user");
  }
  if (lastApplied < 4) {
    await repairPostgresUserSchema(adapter);
    await setMeta(adapter, "schemaVersion", 4);
    lastApplied = 4;
    console.log("[DB][migrate] applied #4 fix-pg-user-columns");
  }
  if (lastApplied < 5) {
    await auditLogPostgres(adapter);
    await setMeta(adapter, "schemaVersion", 5);
    lastApplied = 5;
    console.log("[DB][migrate] applied #5 audit-log");
  }
  if (lastApplied < 6) {
    await securityExtensionsPostgres(adapter);
    await setMeta(adapter, "schemaVersion", 6);
    lastApplied = 6;
    console.log("[DB][migrate] applied #6 security-extensions");
  }
  if (lastApplied < 7) {
    const m007 = (await import("./migrations/007-backfill-connection-userid.js")).default;
    if (m007.upPostgres) await m007.upPostgres(adapter);
    await setMeta(adapter, "schemaVersion", 7);
    lastApplied = 7;
    console.log("[DB][migrate] applied #7 backfill-connection-userid");
  }
  if (lastApplied < 8) {
    const { organizationsPostgres } = await import("./migrations/008-organizations.js");
    await organizationsPostgres(adapter);
    await setMeta(adapter, "schemaVersion", 8);
    lastApplied = 8;
    console.log("[DB][migrate] applied #8 organizations");
  }
  if (lastApplied < 9) {
    const { orgScopePostgres } = await import("./migrations/009-org-scope.js");
    await orgScopePostgres(adapter);
    await setMeta(adapter, "schemaVersion", 9);
    lastApplied = 9;
    console.log("[DB][migrate] applied #9 org-scope");
  }
  return { applied: lastApplied - current, from: current, to: lastApplied };
}

function readJsonSafe(file) {
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

export async function runMigrationOncePostgres(adapter) {
  const fresh = await isFreshDb(adapter);
  await runVersionedMigrations(adapter);
  await verifyMasterKeyAgainstStored(adapter);
  await syncSchemaFromTables(adapter);
  await repairPostgresUserSchema(adapter);

  const legacyMain = readJsonSafe(LEGACY_FILES.main);
  const alreadyImported = fs.existsSync(MIGRATED_MARKER);
  if (fresh && legacyMain && !alreadyImported) {
    const { getDefaultOrgId } = await import("./repos/organizationsRepo.js");
    const orgId = (await getDefaultOrgId()) || "legacy";
    await qRun(
      adapter,
      `INSERT INTO settings(orgId, data) VALUES(?, ?) ON CONFLICT(orgId) DO UPDATE SET data = excluded.data`,
      [orgId, stringifyJson(legacyMain.settings || {})],
    );
    await encryptSecretsPostgres(adapter);
    try { fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString()); } catch {}
    console.log("[DB][migrate] PostgreSQL: legacy db.json settings imported");
  }
}
