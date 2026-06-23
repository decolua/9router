import type { Migration } from "./001-initial.js";

const m005ApikeyRbac: Migration = {
  version: 5,
  name: "apikey rbac",
  up(db) {
    const cols = [
      `ALTER TABLE apiKeys ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`,
      `ALTER TABLE apiKeys ADD COLUMN allowedModels TEXT`,
      `ALTER TABLE apiKeys ADD COLUMN allowedProviders TEXT`,
      `ALTER TABLE apiKeys ADD COLUMN monthlyTokenLimit INTEGER DEFAULT 0`,
      `ALTER TABLE apiKeys ADD COLUMN monthlyBudgetUsd REAL DEFAULT 0`,
      `ALTER TABLE apiKeys ADD COLUMN updatedAt TEXT`,
    ];
    for (const sql of cols) {
      try {
        db.exec(sql);
      } catch (e) {
        if (!/duplicate column name/i.test(String((e as Error)?.message ?? ""))) throw e;
      }
    }
  },
};
export default m005ApikeyRbac;
