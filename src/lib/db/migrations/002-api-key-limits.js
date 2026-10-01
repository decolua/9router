// Add per-key rate limit + model allowlist columns.
export default {
  version: 2,
  name: "api-key-limits",
  up(db) {
    try {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN rateLimit INTEGER DEFAULT 60`);
    } catch (e) {
      // Already exists (additive auto-sync may have added it first)
    }
    try {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN allowedModels TEXT`);
    } catch (e) {
      // Already exists
    }
  },
};