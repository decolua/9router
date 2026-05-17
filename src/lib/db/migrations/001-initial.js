// Initial schema bootstrap. For fresh DB this creates all tables/indexes.
// For existing DB at version 0 (legacy unstamped), it's idempotent (IF NOT EXISTS).
import { TABLES, buildCreateTableSqlForDialect } from "../schema.js";

export default {
  version: 1,
  name: "initial",
  async up(db) {
    const dialect = db.dialect || "sqlite";
    for (const [name, def] of Object.entries(TABLES)) {
      await db.exec(buildCreateTableSqlForDialect(name, def, dialect));
      for (const idx of def.indexes || []) await db.exec(idx);
    }
  },
};
