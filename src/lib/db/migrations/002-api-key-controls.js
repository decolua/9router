// Per-key controls: rate limits, budget, model allowlist, priority, expiry.
// Existing keys get NULLs, which every check reads as "no limit".
const COLUMNS = [
  ["rpm", "INTEGER"],
  ["tpm", "INTEGER"],
  ["maxBudget", "REAL"],
  ["budgetPeriod", "TEXT"],
  ["budgetStartedAt", "TEXT"],
  ["spend", "REAL DEFAULT 0"],
  ["models", "TEXT"],
  ["priority", "TEXT"],
  ["expiresAt", "TEXT"],
];

export default {
  version: 2,
  name: "api-key-controls",
  up(db) {
    const existing = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name));
    for (const [name, type] of COLUMNS) {
      if (existing.has(name)) continue; // re-runnable
      db.exec(`ALTER TABLE apiKeys ADD COLUMN ${name} ${type}`);
    }
  },
};
