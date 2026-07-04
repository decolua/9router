// Migration 004: repair PostgreSQL duplicate lowercase tables/columns from early multi-user DDL.

import bcrypt from "bcryptjs";
import { qAll, qExec, qGet, qRun } from "../query.js";
import { DEFAULT_ADMIN_EMAIL } from "./003-multi-user.js";

const COLUMN_REPAIRS = [
  { table: "users", from: "orgid", to: "orgId" },
  { table: "users", from: "passwordhash", to: "passwordHash" },
  { table: "users", from: "oidcsub", to: "oidcSub" },
  { table: "userSettings", from: "userid", to: "userId" },
  { table: "userInvites", from: "tokenhash", to: "tokenHash" },
  { table: "userInvites", from: "createdby", to: "createdBy" },
];

const DUPLICATE_TABLES = [
  { keep: "userSettings", drop: "usersettings" },
  { keep: "userInvites", drop: "userinvites" },
];

async function tableExists(db, tableName) {
  const row = await qGet(
    db,
    `SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?`,
    [tableName]
  );
  return !!row;
}

async function listColumns(db, tableName) {
  const rows = await qAll(
    db,
    `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
    [tableName]
  );
  return rows.map((r) => r.name);
}

async function mergeDuplicateColumns(db, table, from, to) {
  const cols = await listColumns(db, table);
  const lower = new Map(cols.map((c) => [c.toLowerCase(), c]));
  const fromCol = lower.get(from.toLowerCase());
  const toCol = lower.get(to.toLowerCase());
  if (!fromCol) return;
  if (toCol && fromCol !== toCol) {
    await qRun(
      db,
      `UPDATE "${table}" SET "${to}" = COALESCE("${to}", "${fromCol}") WHERE "${fromCol}" IS NOT NULL`
    );
    await qExec(db, `ALTER TABLE "${table}" DROP COLUMN "${fromCol}"`);
    console.log(`[DB][migrate] 004: merged ${table}.${fromCol} → ${to}`);
    return;
  }
  if (!toCol) {
    await qExec(db, `ALTER TABLE "${table}" RENAME COLUMN "${fromCol}" TO "${to}"`);
    console.log(`[DB][migrate] 004: renamed ${table}.${fromCol} → ${to}`);
  }
}

async function dropDuplicateTable(db, keep, drop) {
  const hasKeep = await tableExists(db, keep);
  const hasDrop = await tableExists(db, drop);
  if (!hasDrop) return;
  if (!hasKeep) {
    await qExec(db, `ALTER TABLE "${drop}" RENAME TO "${keep}"`);
    console.log(`[DB][migrate] 004: renamed table ${drop} → ${keep}`);
    return;
  }
  await qExec(db, `DROP TABLE "${drop}"`);
  console.log(`[DB][migrate] 004: dropped duplicate table ${drop}`);
}

async function ensureAdminPassword(db) {
  const row = await qGet(db, `SELECT id, "passwordHash" FROM users WHERE email = ?`, [DEFAULT_ADMIN_EMAIL]);
  if (!row?.id) return;

  const plain = process.env.INITIAL_PASSWORD || "123456";
  const hash = await bcrypt.hash(plain, 10);
  await qRun(
    db,
    `UPDATE users SET "passwordHash" = ?, status = 'active', "updatedAt" = ? WHERE id = ?`,
    [hash, new Date().toISOString(), row.id]
  );
  console.log(`[DB][migrate] 004: reset ${DEFAULT_ADMIN_EMAIL} password from INITIAL_PASSWORD`);
}

export async function repairPostgresUserSchema(db) {
  for (const { keep, drop } of DUPLICATE_TABLES) {
    await dropDuplicateTable(db, keep, drop);
  }
  for (const repair of COLUMN_REPAIRS) {
    if (await tableExists(db, repair.table)) {
      await mergeDuplicateColumns(db, repair.table, repair.from, repair.to);
    }
  }
  await ensureAdminPassword(db);
}

export default {
  version: 4,
  name: "fix-pg-user-columns",
  up() {
    // PostgreSQL repair runs via repairPostgresUserSchema in migratePostgres.js.
  },
};
