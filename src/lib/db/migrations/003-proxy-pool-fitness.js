// Migration 003: persist proxy-pool fitness by pool and scope.
// Idempotent — safe to re-run on existing databases.
import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 3,
  name: "add-proxy-pool-fitness",
  up(db) {
    const def = TABLES.proxyPoolFitness;
    db.exec(buildCreateTableSql("proxyPoolFitness", def));
    for (const idx of def.indexes || []) db.exec(idx);
  },
};
