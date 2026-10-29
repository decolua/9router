import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 6,
  name: "usage-request-identity",
  up(db) {
    // Legacy DBs stamped schemaVersion=1 by a pre-migrations-system app build
    // never ran 001-initial's table creation (it's skipped once current >= 1),
    // so usageHistory may not exist yet. Self-create it first, same pattern
    // as 003-proxy-pool-fitness.js uses for its own table.
    db.exec(buildCreateTableSql("usageHistory", TABLES.usageHistory));
    const columns = new Set(db.all(`PRAGMA table_info(usageHistory)`).map((column) => column.name));
    if (!columns.has("requestId")) db.exec(`ALTER TABLE usageHistory ADD COLUMN requestId TEXT`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_uh_request_id ON usageHistory(requestId)`);
  },
};
