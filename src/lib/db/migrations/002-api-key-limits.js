export default {
  version: 2,
  name: "api-key-limits",
  up(db) {
    const existing = db.all(`PRAGMA table_info(apiKeys)`);
    const columns = new Set(existing.map((row) => row.name));

    if (!columns.has("dailyTokenLimit")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN dailyTokenLimit INTEGER DEFAULT 0`);
    }
    if (!columns.has("expiresAt")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN expiresAt TEXT`);
    }
    if (!columns.has("allowedModels")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN allowedModels TEXT DEFAULT '[]'`);
    }
  },
};
