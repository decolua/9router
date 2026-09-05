// v2: apiKeys gains allowedModels (JSON array of model/combo names; null = allow all)
// and expiresAt (ISO timestamp; null = never expires). Adds keyPresets table.
// Column adds are guarded by PRAGMA because on a fresh DB m001 already creates
// apiKeys with these columns (TABLES is the current schema).
export default {
  version: 2,
  name: "api-key-permissions",
  up(db) {
    const cols = db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name);
    if (!cols.includes("allowedModels")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN allowedModels TEXT`);
    }
    if (!cols.includes("expiresAt")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN expiresAt TEXT`);
    }
    db.exec(
      `CREATE TABLE IF NOT EXISTS keyPresets(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        models TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )`
    );
  },
};
