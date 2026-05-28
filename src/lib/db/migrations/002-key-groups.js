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
		// Guard: syncSchemaFromTables may have already added this column
		const cols = db.all(`PRAGMA table_info(apiKeys)`);
		const hasGroupId = cols.some((c) => c.name === "groupId");
		if (!hasGroupId) {
			db.exec(
				`ALTER TABLE apiKeys ADD COLUMN groupId TEXT REFERENCES keyGroups(id) ON DELETE SET NULL`,
			);
		}
	},
};
