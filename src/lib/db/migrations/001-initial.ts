import type { DbAdapter } from "../driver.js";
import { TABLES, buildCreateTableSql } from "../schema.js";

export interface Migration {
  version: number;
  name: string;
  up(db: DbAdapter): void;
}

// Initial schema bootstrap. For fresh DB this creates all tables/indexes.
// For existing DB at version 0 (legacy unstamped), it's idempotent (IF NOT EXISTS).
const m001Initial: Migration = {
  version: 1,
  name: "initial",
  up(db) {
    for (const [name, def] of Object.entries(TABLES)) {
      db.exec(buildCreateTableSql(name, def));
      for (const idx of def.indexes ?? []) db.exec(idx);
    }
  },
};
export default m001Initial;
