import { normalizeAllowList } from "@/shared/utils/keyAccess.js";
import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 5,
  name: "canonical-key-policy",
  up(db) {
    // Legacy DBs stamped schemaVersion=1+ by a pre-migrations-system app build
    // never ran 001-initial's table creation (skipped once current >= 1), so
    // apiKeys may not exist yet. Self-create it first, same pattern as
    // 003-proxy-pool-fitness.js and 006-usage-request-identity.js.
    db.exec(buildCreateTableSql("apiKeys", TABLES.apiKeys));
    const columns = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((column) => column.name));
    if (!columns.has("accessRestricted")) db.exec(`ALTER TABLE apiKeys ADD COLUMN accessRestricted INTEGER DEFAULT 0`);
    if (!columns.has("accessAllow")) db.exec(`ALTER TABLE apiKeys ADD COLUMN accessAllow TEXT`);
    const rows = db.all(`SELECT id, allowedModels FROM apiKeys WHERE (accessRestricted = 0 OR accessRestricted IS NULL) AND allowedModels IS NOT NULL`);
    for (const row of rows) {
      let entries;
      try {
        entries = normalizeAllowList(JSON.parse(row.allowedModels));
      } catch {
        continue;
      }
      if (!entries.length) continue;
      db.run(`UPDATE apiKeys SET accessRestricted = 1, accessAllow = ? WHERE id = ? AND (accessRestricted = 0 OR accessRestricted IS NULL)`,
        [JSON.stringify(entries), row.id]);
    }
  },
};
