// Migration 002: Create customAdapters table
import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 2,
  name: "custom-adapters",
  up(db) {
    const def = TABLES.customAdapters;
    db.exec(buildCreateTableSql("customAdapters", def));
    for (const idx of def.indexes || []) db.exec(idx);
  },
};
