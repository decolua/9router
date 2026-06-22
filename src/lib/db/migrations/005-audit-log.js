// Migration 005: security audit log table (90-day retention enforced in repo).

import { TABLES, buildCreateTableSql } from "../schema.js";
import { qExec } from "../query.js";

export async function auditLogPostgres(adapter) {
  const def = TABLES.auditLogs;
  await qExec(adapter, buildCreateTableSql("auditLogs", def, "postgres"));
  for (const idx of def.indexes || []) {
    const pgIdx = idx.replace(/ ON (\w+)\(/g, (_, table) => ` ON "${table}"(`);
    try { await qExec(adapter, pgIdx); } catch {}
  }
}

export default {
  version: 5,
  name: "audit-log",
  up(db) {
    const def = TABLES.auditLogs;
    db.exec(buildCreateTableSql("auditLogs", def));
    for (const idx of def.indexes || []) db.exec(idx);
  },
  upPostgres: auditLogPostgres,
};
