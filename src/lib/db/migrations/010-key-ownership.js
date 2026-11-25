const migration = {
  version: 10, name: "key-ownership",
  up(db) {
    const columns = new Set(db.all("PRAGMA table_info(apiKeys)").map(c => c.name));
    for (const field of ["description", "owner", "project"]) {
      if (!columns.has(field)) db.exec(`ALTER TABLE apiKeys ADD COLUMN ${field} TEXT`);
    }
  },
};

export default migration;
