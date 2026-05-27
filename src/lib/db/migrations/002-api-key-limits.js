export default {
  version: 2,
  name: "api-key-limits",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS apiKeyLimits (
        id TEXT PRIMARY KEY,
        apiKeyId TEXT UNIQUE NOT NULL,
        metricType TEXT NOT NULL,
        periodType TEXT NOT NULL,
        limitValue REAL NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (apiKeyId) REFERENCES apiKeys(id) ON DELETE CASCADE
      )
    `);
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_akl_apiKeyId ON apiKeyLimits(apiKeyId)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_akl_metric_period ON apiKeyLimits(metricType, periodType)",
    );
  },
};
