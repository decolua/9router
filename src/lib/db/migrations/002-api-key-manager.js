function columnExists(db, table, column) {
  return db.all(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const migration = {
  version: 2,
  name: "api-key-manager",
  up(db) {
    addColumn(db, "apiKeys", "limitMode", "TEXT DEFAULT 'unlimited'");
    addColumn(db, "apiKeys", "tokenLimit", "INTEGER");
    addColumn(db, "apiKeys", "expiresAt", "TEXT");
    addColumn(db, "apiKeys", "autoDeleteExpired", "INTEGER DEFAULT 1");
    addColumn(db, "apiKeys", "updatedAt", "TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_uh_apiKey ON usageHistory(apiKey)");
    db.run("UPDATE apiKeys SET limitMode = 'unlimited' WHERE limitMode IS NULL OR limitMode = ''");
    db.run("UPDATE apiKeys SET autoDeleteExpired = 1 WHERE autoDeleteExpired IS NULL");
    db.run("UPDATE apiKeys SET updatedAt = createdAt WHERE updatedAt IS NULL");
  },
};

export default migration;
