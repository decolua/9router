export const DEFAULT_COMBO_LIST_ID = "default";

// Create the comboLists table, backfill combos.listId → default list.
// Idempotent: the additive sync also creates these, but the backfill only
// happens here (once per version bump).
const migration = {
  version: 4,
  name: "combo-lists",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS comboLists (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`);
    const columns = new Set(db.all(`PRAGMA table_info(combos)`).map((row) => row.name));
    if (!columns.has("listId")) db.exec(`ALTER TABLE combos ADD COLUMN listId TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_combo_list ON combos(listId)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cl_sort ON comboLists(sortOrder)`);
    ensureDefaultComboList(db);
    // Re-point any orphaned/dangling listId at the default list so no combo is ever invisible.
    db.run(
      `UPDATE combos SET listId = ? WHERE listId IS NULL OR listId = '' OR listId NOT IN (SELECT id FROM comboLists)`,
      [DEFAULT_COMBO_LIST_ID]
    );
  },
};

export function ensureDefaultComboList(db) {
  const now = new Date().toISOString();
  db.run(
    `INSERT OR IGNORE INTO comboLists(id, name, sortOrder, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)`,
    [DEFAULT_COMBO_LIST_ID, "默认清单", 0, now, now]
  );
}

export default migration;
