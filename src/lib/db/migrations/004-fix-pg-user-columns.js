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
    `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND LOWER(table_name) = LOWER(?)`,
    [tableName]
  );
  return rows.map((r) => r.name);
}

/** Normalize users.orgId — fixes lowercase orgid vs quoted "orgId" mismatch on PostgreSQL. */
export async function ensureUsersOrgIdColumn(db) {
  if (!(await tableExists(db, "users"))) return;

  const cols = await listColumns(db, "users");
  const orgCols = cols.filter((c) => c.toLowerCase() === "orgid");

  if (orgCols.length === 0) {
    await qExec(db, `ALTER TABLE "users" ADD COLUMN "orgId" TEXT`);
    console.log("[DB][repair] added users.orgId column");
  } else if (orgCols.length === 1 && orgCols[0] !== "orgId") {
    await qExec(db, `ALTER TABLE "users" RENAME COLUMN "${orgCols[0]}" TO "orgId"`);
    console.log(`[DB][repair] renamed users.${orgCols[0]} → orgId`);
  } else if (orgCols.length > 1) {
    let canonical = orgCols.find((c) => c === "orgId") || orgCols[0];
    for (const col of orgCols) {
      if (col === canonical) continue;
      await qRun(
        db,
        `UPDATE "users" SET "${canonical}" = COALESCE("${canonical}", "${col}") WHERE "${col}" IS NOT NULL`,
      );
      await qExec(db, `ALTER TABLE "users" DROP COLUMN "${col}"`);
      console.log(`[DB][repair] merged users.${col} → ${canonical}`);
    }
    if (canonical !== "orgId") {
      await qExec(db, `ALTER TABLE "users" RENAME COLUMN "${canonical}" TO "orgId"`);
      canonical = "orgId";
    }
  }

  const defaultOrg = await qGet(db, `SELECT id FROM organizations ORDER BY "createdAt" ASC LIMIT 1`);
  if (defaultOrg?.id) {
    await qRun(
      db,
      `UPDATE "users" SET "orgId" = ? WHERE "orgId" IS NULL OR "orgId" = ''`,
      [defaultOrg.id],
    );
  }

  try {
    await qExec(db, `ALTER TABLE "users" ALTER COLUMN "orgId" SET NOT NULL`);
  } catch {
    // already NOT NULL
  }
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
  await ensureUsersOrgIdColumn(db);
  await ensureAdminPassword(db);
}

export default {
  version: 4,
  name: "fix-pg-user-columns",
  up() {
    // PostgreSQL repair runs via repairPostgresUserSchema in migratePostgres.js.
  },
};
