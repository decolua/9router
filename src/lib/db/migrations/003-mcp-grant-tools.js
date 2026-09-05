import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 3,
  name: "mcp grant tool allowlist",
  up(db) {
    db.exec(buildCreateTableSql("mcpKeyGrants", TABLES.mcpKeyGrants));
    for (const idx of TABLES.mcpKeyGrants.indexes || []) db.exec(idx);
  },
};
