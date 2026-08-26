const COLUMNS = {
  inputCost: "REAL DEFAULT 0",
  cacheReadCost: "REAL DEFAULT 0",
  cacheCreationCost: "REAL DEFAULT 0",
  outputCost: "REAL DEFAULT 0",
  costBreakdownStored: "INTEGER DEFAULT 0",
  requestedModel: "TEXT",
  actualModel: "TEXT",
  smartRoutingProvider: "TEXT",
  smartRoutingModel: "TEXT",
  finalProvider: "TEXT",
  finalModel: "TEXT",
};

const migration = {
  version: 3,
  name: "usage-cost-routing",
  up(db) {
    const existing = new Set(db.all("PRAGMA table_info(usageHistory)").map((column) => column.name));
    for (const [name, definition] of Object.entries(COLUMNS)) {
      if (!existing.has(name)) db.exec(`ALTER TABLE usageHistory ADD COLUMN ${name} ${definition}`);
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_uh_final_route ON usageHistory(finalProvider, finalModel)");
  },
};

export default migration;
