const migration = {
  version: 2,
  name: "convoy-provider-scope",
  up(db) {
    const columns = db.all("PRAGMA table_info(convoyRules)");
    if (!columns.some((column) => column.name === "providerIds")) {
      db.exec("ALTER TABLE convoyRules ADD COLUMN providerIds TEXT DEFAULT '[]'");
    }
  },
};

export default migration;
