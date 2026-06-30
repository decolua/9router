import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 2,
  name: "mcp gateway",
  up(db) {
    db.exec(buildCreateTableSql("mcpInstances", TABLES.mcpInstances));
    for (const idx of TABLES.mcpInstances.indexes || []) db.exec(idx);

    db.exec(buildCreateTableSql("mcpGatewayKeys", TABLES.mcpGatewayKeys));
    for (const idx of TABLES.mcpGatewayKeys.indexes || []) db.exec(idx);
  },
};
