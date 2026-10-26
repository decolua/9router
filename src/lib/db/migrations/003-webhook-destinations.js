import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 3,
  name: "webhook-destinations",
  up(db) {
    db.exec(buildCreateTableSql("webhookDestinations", TABLES.webhookDestinations));
    for (const index of TABLES.webhookDestinations.indexes || []) db.exec(index);
  },
};
