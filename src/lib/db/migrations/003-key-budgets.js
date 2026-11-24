import { TABLES, buildCreateTableSql } from "../schema.js";
export default {
  version: 3, name: "request-budget-ledger",
  up(db) {
    if (!db.all("PRAGMA table_info(apiKeys)").some(c => c.name === "budget")) db.exec("ALTER TABLE apiKeys ADD COLUMN budget TEXT");
    db.exec(buildCreateTableSql("budgetReservations", TABLES.budgetReservations));
    for (const sql of TABLES.budgetReservations.indexes) db.exec(sql);
  },
};
