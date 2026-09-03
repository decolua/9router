// Combo config column for weighted members, retry policies, fusion tuning
import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 2,
  name: "combo-config",
  up(db) {
    // Ensure combos table exists then add config column if missing
    db.exec(buildCreateTableSql("combos", TABLES.combos));
    const cols = db.all(`PRAGMA table_info(combos)`).map((r) => r.name);
    if (!cols.includes("config")) {
      db.exec(`ALTER TABLE combos ADD COLUMN config TEXT`);
    }
    for (const idx of TABLES.combos.indexes || []) {
      try { db.exec(idx); } catch {}
    }
  },
};
