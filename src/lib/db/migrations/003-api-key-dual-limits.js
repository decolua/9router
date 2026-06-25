function columnExists(db, table, column) {
  return db.all(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const migration = {
  version: 3,
  name: "api-key-dual-limits",
  up(db) {
    addColumn(db, "apiKeys", "dailyTokenLimit", "INTEGER");
    addColumn(db, "apiKeys", "weeklyTokenLimit", "INTEGER");
  },
};

export default migration;
