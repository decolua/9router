// Migration 005: security audit log table (90-day retention enforced in repo).

import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 5,
  name: "audit-log",
  up(db) {
    const def = TABLES.auditLogs;
    db.exec(buildCreateTableSql("auditLogs", def));
    for (const idx of def.indexes || []) db.exec(idx);
  },
};
