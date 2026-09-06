export default {
  version: 2,
  name: "api-key-scopes-and-limits",
  up(db) {
    const cols = [
      { name: "allowedModels", def: "TEXT" },
      { name: "blockedModels", def: "TEXT" },
      { name: "allowedCombos", def: "TEXT" },
      { name: "scopes", def: "TEXT" },
      { name: "expiresAt", def: "TEXT" },
      { name: "lastUsedAt", def: "TEXT" },
      { name: "maxRequestsPerDay", def: "INTEGER" },
      { name: "maxSpendUsdPerDay", def: "REAL" },
    ];
    const existing = db.all(`PRAGMA table_info(apiKeys)`);
    const existingNames = new Set(existing.map((r) => r.name));
    for (const col of cols) {
      if (!existingNames.has(col.name)) {
        db.exec(`ALTER TABLE apiKeys ADD COLUMN ${col.name} ${col.def}`);
      }
    }
  },
};
