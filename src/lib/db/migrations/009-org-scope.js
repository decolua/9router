// Migration 009: org-scope shared resources (nodes, proxy pools, usage daily, audit).

import { qAll, qExec, qGet, qRun } from "../query.js";
import { setMetaSync } from "../helpers/metaStore.js";
import { META_DEFAULT_ORG_ID } from "../repos/organizationsRepo.js";

const SHARED_TABLES = ["providerNodes", "proxyPools"];

function tableHasColumnSync(db, table, column) {
  try {
    return db.all(`PRAGMA table_info(${table})`).some((c) => c.name === column);
  } catch {
    return false;
  }
}

async function tableHasColumnPg(db, table, column) {
  const row = await qGet(
    db,
    `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return !!row;
}

function addOrgIdColumnSync(db, table, defaultOrgId) {
  if (!tableHasColumnSync(db, table, "orgId")) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN orgId TEXT`); } catch {}
  }
  db.run(`UPDATE ${table} SET orgId = ? WHERE orgId IS NULL OR orgId = ''`, [defaultOrgId]);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_orgId ON ${table}(orgId)`); } catch {}
}

async function addOrgIdColumnPg(db, table, defaultOrgId) {
  const has = await tableHasColumnPg(db, table, "orgId");
  if (!has) {
    try { await qExec(db, `ALTER TABLE "${table}" ADD COLUMN "orgId" TEXT`); } catch {}
  }
  await qRun(db, `UPDATE "${table}" SET "orgId" = ? WHERE "orgId" IS NULL OR "orgId" = ''`, [defaultOrgId]);
  try { await qExec(db, `CREATE INDEX IF NOT EXISTS idx_${table}_orgId ON "${table}"("orgId")`); } catch {}
}

function migrateUsageDailySync(db, defaultOrgId) {
  if (tableHasColumnSync(db, "usageDaily", "orgId")) return;

  const rows = db.all(`SELECT dateKey, data FROM usageDaily`);
  db.exec(`DROP TABLE IF EXISTS usageDaily`);
  db.exec(`CREATE TABLE usageDaily (orgId TEXT NOT NULL, dateKey TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (orgId, dateKey))`);
  for (const row of rows) {
    db.run(`INSERT INTO usageDaily(orgId, dateKey, data) VALUES(?, ?, ?)`, [defaultOrgId, row.dateKey, row.data]);
  }
}

async function migrateUsageDailyPg(db, defaultOrgId) {
  const has = await tableHasColumnPg(db, "usageDaily", "orgId");
  if (has) return;

  const rows = await qAll(db, `SELECT dateKey, data FROM usageDaily`);
  await qExec(db, `DROP TABLE IF EXISTS usageDaily`);
  await qExec(db, `CREATE TABLE usageDaily ("orgId" TEXT NOT NULL, dateKey TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY ("orgId", dateKey))`);
  for (const row of rows) {
    await qRun(db, `INSERT INTO usageDaily("orgId", dateKey, data) VALUES(?, ?, ?)`, [defaultOrgId, row.dateKey, row.data]);
  }
}

function migrateAuditLogsSync(db, defaultOrgId) {
  if (!tableHasColumnSync(db, "auditLogs", "orgId")) {
    try { db.exec(`ALTER TABLE auditLogs ADD COLUMN orgId TEXT`); } catch {}
  }
  db.run(
    `UPDATE auditLogs SET orgId = (SELECT orgId FROM users WHERE users.id = auditLogs.actorUserId) WHERE orgId IS NULL AND actorUserId IS NOT NULL`,
  );
  db.run(`UPDATE auditLogs SET orgId = ? WHERE orgId IS NULL OR orgId = ''`, [defaultOrgId]);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_orgId ON auditLogs(orgId)`); } catch {}
}

async function migrateAuditLogsPg(db, defaultOrgId) {
  const has = await tableHasColumnPg(db, "auditLogs", "orgId");
  if (!has) {
    try { await qExec(db, `ALTER TABLE auditLogs ADD COLUMN "orgId" TEXT`); } catch {}
  }
  await qRun(
    db,
    `UPDATE auditLogs SET "orgId" = (SELECT "orgId" FROM users WHERE users.id = auditLogs."actorUserId") WHERE "orgId" IS NULL AND "actorUserId" IS NOT NULL`,
  );
  await qRun(db, `UPDATE auditLogs SET "orgId" = ? WHERE "orgId" IS NULL OR "orgId" = ''`, [defaultOrgId]);
  try { await qExec(db, `CREATE INDEX IF NOT EXISTS idx_audit_orgId ON auditLogs("orgId")`); } catch {}
}

function resolveDefaultOrgIdSync(db) {
  const fromMeta = db.get(`SELECT value FROM _meta WHERE key = ?`, [META_DEFAULT_ORG_ID]);
  if (fromMeta?.value) return fromMeta.value;
  const row = db.get(`SELECT id FROM organizations WHERE slug = 'default'`);
  return row?.id || null;
}

async function resolveDefaultOrgIdPg(db) {
  const fromMeta = await qGet(db, `SELECT value FROM _meta WHERE key = ?`, [META_DEFAULT_ORG_ID]);
  if (fromMeta?.value) return fromMeta.value;
  const row = await qGet(db, `SELECT id FROM organizations WHERE slug = 'default'`);
  return row?.id || null;
}

export async function orgScopePostgres(db) {
  const defaultOrgId = await resolveDefaultOrgIdPg(db);
  if (!defaultOrgId) return;

  for (const table of SHARED_TABLES) {
    await addOrgIdColumnPg(db, table, defaultOrgId);
  }
  await migrateUsageDailyPg(db, defaultOrgId);
  await migrateAuditLogsPg(db, defaultOrgId);
  console.log(`[DB][migrate] 009-org-scope: scoped shared tables to org ${defaultOrgId}`);
}

export default {
  version: 9,
  name: "org-scope",
  up(db) {
    const defaultOrgId = resolveDefaultOrgIdSync(db);
    if (!defaultOrgId) return;

    for (const table of SHARED_TABLES) {
      addOrgIdColumnSync(db, table, defaultOrgId);
    }
    migrateUsageDailySync(db, defaultOrgId);
    migrateAuditLogsSync(db, defaultOrgId);
    setMetaSync(db, META_DEFAULT_ORG_ID, defaultOrgId);
    console.log(`[DB][migrate] 009-org-scope: scoped shared tables to org ${defaultOrgId}`);
  },
};
