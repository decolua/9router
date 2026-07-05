// Add `policy` JSON column to apiKeys for per-key model allowlist (and future
// token/cost limits). Additive only — syncSchemaFromTables also handles this
// for existing DBs, but the migration stamps the version for traceability.
export default {
  version: 2,
  name: "api-key-policy",
  up(db) {
    const cols = db.all(`PRAGMA table_info(apiKeys)`);
    if (!cols.some((c) => c.name === "policy")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN policy TEXT`);
    }
  },
};
