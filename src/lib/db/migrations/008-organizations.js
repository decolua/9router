// Migration 008: multi-organization support (SaaS + on-prem default org).
// Creates organizations table, adds orgId to tenant tables, migrates settings PK.

import { v4 as uuidv4 } from "uuid";
import { qAll, qExec, qGet, qRun } from "../query.js";
import { TABLES, buildCreateTableSql } from "../schema.js";
import { setMetaSync } from "../helpers/metaStore.js";
import {
  DEFAULT_ORG_SLUG,
  META_DEFAULT_ORG_ID,
  ensureDefaultOrganizationSync,
} from "../repos/organizationsRepo.js";

const TENANT_TABLES = [
  "providerConnections",
  "apiKeys",
  "combos",
  "usageHistory",
  "requestDetails",
];

function tableHasColumnSync(db, table, column) {
  try {
    const cols = db.all(`PRAGMA table_info(${table})`);
    return cols.some((c) => c.name === column);
  } catch {
    return false;
  }
}

function migrateSettingsToOrgIdSync(db, defaultOrgId) {
  if (tableHasColumnSync(db, "settings", "orgId") && !tableHasColumnSync(db, "settings", "id")) {
    const bootstrap = db.get(`SELECT orgId, data FROM settings WHERE orgId = 'bootstrap'`);
    if (bootstrap && defaultOrgId && bootstrap.orgId !== defaultOrgId) {
      db.run(`INSERT INTO settings(orgId, data) VALUES(?, ?) ON CONFLICT(orgId) DO UPDATE SET data = excluded.data`, [defaultOrgId, bootstrap.data]);
      db.run(`DELETE FROM settings WHERE orgId = 'bootstrap'`);
    }
    return;
  }

  const row = db.get(`SELECT data FROM settings WHERE id = 1`) || db.get(`SELECT data FROM settings LIMIT 1`);
  db.exec(`CREATE TABLE settings_new (orgId TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  if (row?.data) {
    db.run(`INSERT INTO settings_new(orgId, data) VALUES(?, ?)`, [defaultOrgId, row.data]);
  }
  db.exec(`DROP TABLE settings`);
  db.exec(`ALTER TABLE settings_new RENAME TO settings`);
}

function recreateUsersWithOrgIdSync(db, defaultOrgId) {
  if (tableHasColumnSync(db, "users", "orgId") && !tableHasColumnSync(db, "users", "email")) {
    // already migrated with orgId and no bare email unique
  }

  const hasOrgId = tableHasColumnSync(db, "users", "orgId");
  if (hasOrgId) {
    db.run(`UPDATE users SET orgId = ? WHERE orgId IS NULL OR orgId = ''`, [defaultOrgId]);
    try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email ON users(orgId, email)`); } catch {}
    try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_oidc ON users(orgId, oidcSub) WHERE oidcSub IS NOT NULL`); } catch {}
    return;
  }

  db.exec(`
    CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      orgId TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      passwordHash TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      oidcSub TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      mfaEnabled INTEGER DEFAULT 0,
      mfaSecret TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  const users = db.all(`SELECT * FROM users`);
  for (const u of users) {
    db.run(
      `INSERT INTO users_new(id, orgId, email, name, passwordHash, role, oidcSub, status, mfaEnabled, mfaSecret, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        u.id,
        defaultOrgId,
        u.email,
        u.name,
        u.passwordHash,
        u.role || "member",
        u.oidcSub || null,
        u.status || "active",
        u.mfaEnabled ?? 0,
        u.mfaSecret || null,
        u.createdAt,
        u.updatedAt,
      ],
    );
  }

  db.exec(`DROP TABLE users`);
  db.exec(`ALTER TABLE users_new RENAME TO users`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email ON users(orgId, email)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_oidc ON users(orgId, oidcSub) WHERE oidcSub IS NOT NULL`);
}

function addOrgIdColumnSync(db, table, defaultOrgId) {
  if (tableHasColumnSync(db, table, "orgId")) {
    db.run(`UPDATE ${table} SET orgId = ? WHERE orgId IS NULL OR orgId = ''`, [defaultOrgId]);
    return;
  }
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN orgId TEXT`);
  } catch {}
  db.run(`UPDATE ${table} SET orgId = ? WHERE orgId IS NULL OR orgId = ''`, [defaultOrgId]);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_orgId ON ${table}(orgId)`); } catch {}
}

async function tableHasColumnPg(db, table, column) {
  const row = await qGet(
    db,
    `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return !!row;
}

async function migrateSettingsToOrgIdPostgres(db, defaultOrgId) {
  const hasOrgId = await tableHasColumnPg(db, "settings", "orgId");
  const hasId = await tableHasColumnPg(db, "settings", "id");
  if (hasOrgId && !hasId) return;

  const row = await qGet(db, `SELECT data FROM settings WHERE id = 1`);
  await qExec(db, `CREATE TABLE IF NOT EXISTS settings_new ("orgId" TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  if (row?.data) {
    await qRun(db, `INSERT INTO settings_new("orgId", data) VALUES(?, ?)`, [defaultOrgId, row.data]);
  }
  await qExec(db, `DROP TABLE IF EXISTS settings`);
  await qExec(db, `ALTER TABLE settings_new RENAME TO settings`);
}

async function recreateUsersWithOrgIdPostgres(db, defaultOrgId) {
  const hasOrgId = await tableHasColumnPg(db, "users", "orgId");
  if (hasOrgId) {
    await qRun(db, `UPDATE users SET "orgId" = ? WHERE "orgId" IS NULL OR "orgId" = ''`, [defaultOrgId]);
    try { await qExec(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email ON users("orgId", email)`); } catch {}
    try { await qExec(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_oidc ON users("orgId", "oidcSub") WHERE "oidcSub" IS NOT NULL`); } catch {}
    return;
  }

  await qExec(db, `
    CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      "orgId" TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      "passwordHash" TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      "oidcSub" TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      "mfaEnabled" INTEGER DEFAULT 0,
      "mfaSecret" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )
  `);

  const users = await qAll(db, `SELECT * FROM users`);
  for (const u of users) {
    await qRun(
      db,
      `INSERT INTO users_new(id, "orgId", email, name, "passwordHash", role, "oidcSub", status, "mfaEnabled", "mfaSecret", "createdAt", "updatedAt")
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        u.id,
        defaultOrgId,
        u.email,
        u.name,
        u.passwordHash ?? u.passwordhash,
        u.role || "member",
        u.oidcSub ?? u.oidcsub ?? null,
        u.status || "active",
        u.mfaEnabled ?? u.mfaenabled ?? 0,
        u.mfaSecret ?? u.mfasecret ?? null,
        u.createdAt ?? u.createdat,
        u.updatedAt ?? u.updatedat,
      ],
    );
  }

  await qExec(db, `DROP TABLE users`);
  await qExec(db, `ALTER TABLE users_new RENAME TO users`);
  await qExec(db, `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  await qExec(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email ON users("orgId", email)`);
  await qExec(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_oidc ON users("orgId", "oidcSub") WHERE "oidcSub" IS NOT NULL`);
}

async function addOrgIdColumnPostgres(db, table, defaultOrgId) {
  const hasOrgId = await tableHasColumnPg(db, table, "orgId");
  if (!hasOrgId) {
    try { await qExec(db, `ALTER TABLE "${table}" ADD COLUMN "orgId" TEXT`); } catch {}
  }
  await qRun(db, `UPDATE "${table}" SET "orgId" = ? WHERE "orgId" IS NULL OR "orgId" = ''`, [defaultOrgId]);
  try { await qExec(db, `CREATE INDEX IF NOT EXISTS idx_${table}_orgId ON "${table}"("orgId")`); } catch {}
}

async function ensureDefaultOrgPostgres(db) {
  const existing = await qGet(db, `SELECT id FROM organizations WHERE slug = ?`, [DEFAULT_ORG_SLUG]);
  if (existing?.id) {
    await qRun(
      db,
      `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [META_DEFAULT_ORG_ID, existing.id],
    );
    return existing.id;
  }

  const now = new Date().toISOString();
  const id = uuidv4();
  const name = process.env.INSTANCE_NAME || "Default Organization";
  await qRun(
    db,
    `INSERT INTO organizations(id, slug, name, status, plan, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [id, DEFAULT_ORG_SLUG, name, "active", "free", now, now],
  );
  await qRun(
    db,
    `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [META_DEFAULT_ORG_ID, id],
  );
  return id;
}

export async function organizationsPostgres(db) {
  await qExec(db, buildCreateTableSql("organizations", TABLES.organizations, "postgres"));
  for (const idx of TABLES.organizations.indexes || []) {
    const pgIdx = idx.replace(/ ON (\w+)\(/g, (_, table) => ` ON "${table}"(`);
    try { await qExec(db, pgIdx); } catch {}
  }

  const defaultOrgId = await ensureDefaultOrgPostgres(db);

  await migrateSettingsToOrgIdPostgres(db, defaultOrgId);
  await recreateUsersWithOrgIdPostgres(db, defaultOrgId);

  for (const table of TENANT_TABLES) {
    await addOrgIdColumnPostgres(db, table, defaultOrgId);
  }
  await addOrgIdColumnPostgres(db, "userInvites", defaultOrgId);

  console.log(`[DB][migrate] 008-organizations: default org ${DEFAULT_ORG_SLUG} (${defaultOrgId})`);
}

export default {
  version: 8,
  name: "organizations",
  up(db) {
    db.exec(buildCreateTableSql("organizations", TABLES.organizations));
    for (const idx of TABLES.organizations.indexes || []) {
      try { db.exec(idx); } catch {}
    }

    const defaultOrgId = ensureDefaultOrganizationSync(db);

    migrateSettingsToOrgIdSync(db, defaultOrgId);
    recreateUsersWithOrgIdSync(db, defaultOrgId);

    for (const table of TENANT_TABLES) {
      addOrgIdColumnSync(db, table, defaultOrgId);
    }
    addOrgIdColumnSync(db, "userInvites", defaultOrgId);

    setMetaSync(db, META_DEFAULT_ORG_ID, defaultOrgId);
    console.log(`[DB][migrate] 008-organizations: default org ${DEFAULT_ORG_SLUG} (${defaultOrgId})`);
  },
};

export { DEFAULT_ORG_SLUG, TENANT_TABLES };
