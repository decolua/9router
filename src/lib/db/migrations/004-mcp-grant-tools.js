// Add a nullable per-grant tool allowlist. When set (JSON array of bare tool
// names), the gateway filters that instance's tools down to the list for
// that key. NULL = all tools visible (default).
export default {
  version: 4,
  name: "mcp grant tool allowlist",
  up(db) {
    // SQLite ALTER TABLE ADD COLUMN is the only safe way to add a column
    // to an existing table; safe because the column is nullable.
    try {
      db.exec(`ALTER TABLE mcpKeyGrants ADD COLUMN toolAllowlist TEXT`);
    } catch (e) {
      // If the column already exists (idempotent run on existing DB),
      // swallow — the migration runner is "skip-version safe" but we
      // may still re-enter this up() on edge cases.
      if (!/duplicate column name/i.test(String(e?.message || ""))) throw e;
    }
  },
};
