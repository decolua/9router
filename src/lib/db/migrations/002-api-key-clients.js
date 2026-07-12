import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 2,
  name: "api-key-clients",
  up(db) {
    const def = TABLES.apiKeyClients;
    db.exec(buildCreateTableSql("apiKeyClients", def));
    for (const idx of def.indexes || []) db.exec(idx);
  },
};

export default migration;
