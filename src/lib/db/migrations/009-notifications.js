import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 9, name: "notifications",
  up(db) {
    for (const name of ["notifications", "notificationChannels", "notificationMutes",
      "notificationDeliveries", "notificationOutages"]) {
      db.exec(buildCreateTableSql(name, TABLES[name]));
      for (const sql of TABLES[name].indexes ?? []) db.exec(sql);
    }
  },
};

export default migration;
