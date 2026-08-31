// Initial schema bootstrap. For fresh DB this creates all tables/indexes.
// Idempotent (IF NOT EXISTS) so it is safe on an already-populated DB at
// version 0.
import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 1,
  name: "initial",
  async up(db) {
    for (const [name, def] of Object.entries(TABLES)) {
      await db.exec(buildCreateTableSql(name, def));
      for (const idx of def.indexes || []) await db.exec(idx);
    }
  },
};
