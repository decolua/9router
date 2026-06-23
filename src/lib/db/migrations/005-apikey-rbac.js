// Add per-key RBAC fields: role, model/provider allowlists, monthly token + USD caps.
// Empty/null allowlist = no restriction. role defaults to 'user'. updatedAt for change tracking.
const m005ApikeyRbac = {
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
        // Idempotent: column may already exist on re-entry.
        if (!/duplicate column name/i.test(String(e?.message || ""))) throw e;
      }
    }
  },
};
export default m005ApikeyRbac;
