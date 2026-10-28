import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 4,
  name: "webhook-deliveries",
  up(db) {
    db.exec(buildCreateTableSql("webhookDeliveries", TABLES.webhookDeliveries));
    for (const index of TABLES.webhookDeliveries.indexes) db.exec(index);
    db.run("INSERT OR IGNORE INTO _meta(key, value) VALUES('webhookGeneration', '1')");
  },
};
