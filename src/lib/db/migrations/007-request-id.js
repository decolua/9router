import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 7,
  name: "usage-request-id",
  up(db) {
    db.exec(buildCreateTableSql("usageHistory", TABLES.usageHistory));
    const columns = db.all("PRAGMA table_info(usageHistory)");
    if (!columns.some(c => c.name === "requestId")) db.exec("ALTER TABLE usageHistory ADD COLUMN requestId TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_uh_request ON usageHistory(requestId)");
  },
};

export default migration;
