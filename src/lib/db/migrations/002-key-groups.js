export default {
  version: 2,
  name: "key-groups",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS keyGroups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      allowedConnectionIds TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_kg_name ON keyGroups(name)`);
    db.exec(`ALTER TABLE apiKeys ADD COLUMN groupId TEXT REFERENCES keyGroups(id) ON DELETE SET NULL`);
  },
};
