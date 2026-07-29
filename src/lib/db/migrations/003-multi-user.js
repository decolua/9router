// Migration 003: org-scoped multi-user workspaces.
// Creates users table, adds userId to tenant tables, backfills a default admin from legacy data.

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { parseEncryptedJson, stringifyEncryptedJson } from "../helpers/encryptedJsonCol.js";
import { isMasterKeyConfigured } from "../../crypto/masterKey.js";
import { setMetaSync } from "../helpers/metaStore.js";
import { readSettingsDataSync, readSettingsDataPostgres, writeSettingsDataSync, writeSettingsDataPostgres } from "../helpers/settingsRow.js";
import { TABLES, buildCreateTableSql } from "../schema.js";
import { ensureDefaultOrganizationSync } from "../repos/organizationsRepo.js";

const DEFAULT_ADMIN_EMAIL = "admin@local";
const USER_SCOPED_KV = ["modelAliases", "customModels", "mitmAlias"];

const USER_SETTINGS_KEYS = [
  "stickyRoundRobinLimit",
  "providerStrategies",
  "comboStrategy",
  "comboStickyRoundRobinLimit",
  "comboStrategies",
  "enableObservability",
  "observabilityMaxRecords",
  "observabilityBatchSize",
  "observabilityFlushIntervalMs",
  "observabilityMaxJsonSize",
];

function readSettingsData(raw) {
  if (!raw) return {};
  return isMasterKeyConfigured() ? parseEncryptedJson(raw, {}) : parseJson(raw, {});
}

function userKvScope(scope, userId) {
  return `${scope}:user:${userId}`;
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function resolveLegacyPassword(settings) {
  if (settings?.password) return null; // already hashed in settings — copy hash directly
  return process.env.INITIAL_PASSWORD || "123456";
}

function usersHasOrgIdSync(db) {
  try {
    return db.all("PRAGMA table_info(users)").some((c) => c.name === "orgId");
  } catch {
    return false;
  }
}

function createAdminUserSync(db, settingsRaw) {
  const settings = readSettingsData(settingsRaw);
  const now = new Date().toISOString();
  const adminId = uuidv4();
  let passwordHash = settings.password || null;
  if (!passwordHash) {
    passwordHash = hashPassword(resolveLegacyPassword(settings));
  }

  const withOrgId = usersHasOrgIdSync(db);
  let orgId = null;
  if (withOrgId) {
    try {
      db.exec(buildCreateTableSql("organizations", TABLES.organizations));
    } catch {}
    orgId = ensureDefaultOrganizationSync(db);
  }

  if (withOrgId) {
    db.run(
      `INSERT INTO users(id, orgId, email, name, passwordHash, role, status, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [adminId, orgId, DEFAULT_ADMIN_EMAIL, "Admin", passwordHash, "admin", "active", now, now],
    );
  } else {
    db.run(
      `INSERT INTO users(id, email, name, passwordHash, role, status, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [adminId, DEFAULT_ADMIN_EMAIL, "Admin", passwordHash, "admin", "active", now, now],
    );
  }

  const userPrefs = {};
  for (const key of USER_SETTINGS_KEYS) {
    if (settings[key] !== undefined) userPrefs[key] = settings[key];
  }
  db.run(
    `INSERT INTO userSettings(userId, data) VALUES(?, ?)`,
    [adminId, JSON.stringify(userPrefs)]
  );

  // Strip per-user keys from org settings blob (keep org infra config).
  const orgSettings = { ...settings };
  delete orgSettings.password;
  for (const key of USER_SETTINGS_KEYS) delete orgSettings[key];
  orgSettings.multiUserEnabled = true;
  orgSettings.signupMode = orgSettings.signupMode || "invite";

  return { adminId, orgSettings, orgId: withOrgId ? orgId : null };
}

function backfillUserIdSync(db, adminId) {
  for (const table of ["providerConnections", "apiKeys", "combos", "usageHistory", "requestDetails"]) {
    try {
      db.run(`UPDATE ${table} SET userId = ? WHERE userId IS NULL OR userId = ''`, [adminId]);
    } catch { /* column may not exist yet */ }
  }

  for (const scope of USER_SCOPED_KV) {
    const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [scope]);
    const targetScope = userKvScope(scope, adminId);
    for (const row of rows) {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [targetScope, row.key, row.value]
      );
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [scope, row.key]);
    }
  }
}

function ensureColumnsSync(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      passwordHash TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      oidcSub TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_oidcSub ON users(oidcSub);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS userSettings (
      userId TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS userInvites (
      id TEXT PRIMARY KEY,
      email TEXT,
      tokenHash TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      createdBy TEXT,
      expiresAt TEXT,
      usedAt TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invites_tokenHash ON userInvites(tokenHash);
  `);

  const addCol = (table, col, def) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* exists */ }
  };

  for (const table of ["providerConnections", "apiKeys", "combos", "usageHistory", "requestDetails"]) {
    addCol(table, "userId", "TEXT");
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_userId ON ${table}(userId)`); } catch {}
  }
}

export async function multiUserPostgres(db) {
  const { qExec, qAll, qGet, qRun } = await import("../query.js");

  for (const table of ["users", "userSettings", "userInvites"]) {
    await qExec(db, buildCreateTableSql(table, TABLES[table], "postgres"));
    for (const idx of TABLES[table].indexes || []) {
      const pgIdx = idx.replace(/ ON (\w+)\(/g, (m, t) => ` ON "${t}"(`);
      try { await qExec(db, pgIdx); } catch {}
    }
  }

  for (const table of ["providerConnections", "apiKeys", "combos", "usageHistory", "requestDetails"]) {
    try { await qExec(db, `ALTER TABLE "${table}" ADD COLUMN "userId" TEXT`); } catch {}
    try { await qExec(db, `CREATE INDEX IF NOT EXISTS idx_${table}_userId ON "${table}"("userId")`); } catch {}
  }

  const existingAdmin = await qGet(db, `SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (existingAdmin) return;

  await qExec(db, buildCreateTableSql("organizations", TABLES.organizations, "postgres"));
  const defaultOrgId = await (async () => {
    const row = await qGet(db, `SELECT id FROM organizations WHERE slug = 'default'`);
    if (row?.id) return row.id;
    const now = new Date().toISOString();
    const id = uuidv4();
    await qRun(
      db,
      `INSERT INTO organizations(id, slug, name, status, plan, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [id, "default", process.env.INSTANCE_NAME || "Default Organization", "active", "free", now, now],
    );
    return id;
  })();

  const settingsRaw = await readSettingsDataPostgres(db);
  const settings = readSettingsData(settingsRaw);
  const now = new Date().toISOString();
  const adminId = uuidv4();
  let passwordHash = settings.password || null;
  if (!passwordHash) passwordHash = hashPassword(resolveLegacyPassword(settings));

  const userCols = await qAll(
    db,
    `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
    ["users"],
  );
  const hasOrgId = userCols.some((c) => String(c.name).toLowerCase() === "orgid");

  if (hasOrgId) {
    await qRun(
      db,
      `INSERT INTO users(id, "orgId", email, name, "passwordHash", role, status, "createdAt", "updatedAt") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [adminId, defaultOrgId, DEFAULT_ADMIN_EMAIL, "Admin", passwordHash, "admin", "active", now, now],
    );
  } else {
    await qRun(
      db,
      `INSERT INTO users(id, email, name, "passwordHash", role, status, "createdAt", "updatedAt") VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [adminId, DEFAULT_ADMIN_EMAIL, "Admin", passwordHash, "admin", "active", now, now],
    );
  }

  const userPrefs = {};
  for (const key of USER_SETTINGS_KEYS) {
    if (settings[key] !== undefined) userPrefs[key] = settings[key];
  }
  await qRun(db, `INSERT INTO userSettings(userId, data) VALUES(?, ?)`, [adminId, JSON.stringify(userPrefs)]);

  const orgSettings = { ...settings };
  delete orgSettings.password;
  for (const key of USER_SETTINGS_KEYS) delete orgSettings[key];
  orgSettings.multiUserEnabled = true;
  orgSettings.signupMode = orgSettings.signupMode || "invite";

  const { stringifyEncryptedJson } = await import("../helpers/encryptedJsonCol.js");
  const { stringifyJson } = await import("../helpers/jsonCol.js");
  const serializeSettings = isMasterKeyConfigured() ? stringifyEncryptedJson : stringifyJson;
  await writeSettingsDataPostgres(db, serializeSettings(orgSettings), { orgId: defaultOrgId });

  for (const table of ["providerConnections", "apiKeys", "combos", "usageHistory", "requestDetails"]) {
    await qRun(db, `UPDATE "${table}" SET "userId" = ? WHERE "userId" IS NULL OR "userId" = ''`, [adminId]);
  }

  for (const scope of USER_SCOPED_KV) {
    const rows = await qAll(db, `SELECT key, value FROM kv WHERE scope = ?`, [scope]);
    const targetScope = userKvScope(scope, adminId);
    for (const row of rows) {
      await qRun(
        db,
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [targetScope, row.key, row.value]
      );
      await qRun(db, `DELETE FROM kv WHERE scope = ? AND key = ?`, [scope, row.key]);
    }
  }

  console.log(`[DB][migrate] 003-multi-user: created admin ${DEFAULT_ADMIN_EMAIL} (${adminId})`);
}

export default {
  version: 3,
  name: "multi-user",
  up(db) {
    ensureColumnsSync(db);

    const existingAdmin = db.get(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    if (existingAdmin) {
      console.log("[DB][migrate] 003-multi-user: admin already exists, skipping backfill");
      return;
    }

    const settingsRaw = readSettingsDataSync(db);
    const { adminId, orgSettings, orgId } = createAdminUserSync(db, settingsRaw);

    const serializeSettings = isMasterKeyConfigured() ? stringifyEncryptedJson : stringifyJson;
    writeSettingsDataSync(db, serializeSettings(orgSettings), { orgId: orgId || "bootstrap" });

    backfillUserIdSync(db, adminId);
    setMetaSync(db, "defaultAdminUserId", adminId);
    console.log(`[DB][migrate] 003-multi-user: created admin ${DEFAULT_ADMIN_EMAIL} (${adminId})`);
  },
};

export { DEFAULT_ADMIN_EMAIL, USER_SETTINGS_KEYS, userKvScope };
