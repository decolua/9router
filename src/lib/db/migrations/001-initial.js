// Initial schema bootstrap. For fresh DB this creates all tables/indexes.
// For existing DB at version 0 (legacy unstamped), it's idempotent (IF NOT EXISTS).
import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 1,
  name: "initial",
  up(db) {
    for (const [name, def] of Object.entries(TABLES)) {
      db.exec(buildCreateTableSql(name, def));
      const columns = new Set(db.all(`PRAGMA table_info(${name})`).map((column) => column.name));
      for (const idx of def.indexes || []) {
        if (name === "usageHistory" && idx.includes("idx_uh_request_id") && !columns.has("requestId")) continue;
        db.exec(idx);
      }
    }
  },
};
