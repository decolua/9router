// Migration 010: ensure users.orgId column is canonical on PostgreSQL (Render/production fix).

import { qExec, qGet, qRun } from "../query.js";
import { ensureUsersOrgIdColumn } from "./004-fix-pg-user-columns.js";

export async function fixUsersOrgIdPostgres(db) {
  await ensureUsersOrgIdColumn(db);
}

export default {
  version: 10,
  name: "fix-users-orgid-column",
  up() {
    // PostgreSQL repair runs via fixUsersOrgIdPostgres in migratePostgres.js.
  },
};
