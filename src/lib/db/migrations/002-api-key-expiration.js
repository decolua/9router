function hasColumn(db, tableName, columnName) {
  return db.all(`PRAGMA table_info(${tableName})`).some((row) => row.name === columnName);
}

function addColumn(db, tableName, columnName, definition) {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export default {
  version: 2,
  name: "api-key-expiration",
  up(db) {
    addColumn(db, "apiKeys", "planMonths", "INTEGER");
    addColumn(db, "apiKeys", "expiresAt", "TEXT");
    addColumn(db, "apiKeys", "deactivatedReason", "TEXT");
    addColumn(db, "apiKeys", "updatedAt", "TEXT");
    db.run(`UPDATE apiKeys SET updatedAt = createdAt WHERE updatedAt IS NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ak_active_expires ON apiKeys(isActive, expiresAt)`);
  },
};
