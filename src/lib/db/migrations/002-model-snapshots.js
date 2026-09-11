// Model snapshots + import sessions for the model-import feature.
// Additive only — creates two new tables. Runs once via the versioned
// migration chain (version 2), then additive auto-sync never touches them
// because they are not declared in schema.js TABLES.
const migration = {
  version: 2,
  name: "model-snapshots",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS modelSnapshots (
        id TEXT PRIMARY KEY,
        discoveryBatchId TEXT NOT NULL,
        providerAlias TEXT NOT NULL,
        connectionId TEXT NOT NULL,
        rawModelId TEXT NOT NULL,
        canonicalId TEXT NOT NULL,
        displayName TEXT,
        modelKind TEXT NOT NULL DEFAULT 'unknown',
        source TEXT NOT NULL DEFAULT 'upstream_api',
        confidence TEXT NOT NULL DEFAULT 'low',
        contextWindow INTEGER,
        maxOutput INTEGER,
        inputModalities TEXT,
        outputModalities TEXT,
        supportsReasoning INTEGER NOT NULL DEFAULT 0,
        supportsTools INTEGER NOT NULL DEFAULT 0,
        supportsSearch INTEGER NOT NULL DEFAULT 0,
        supportsVision INTEGER NOT NULL DEFAULT 0,
        rawPayload TEXT,
        rawPayloadHash TEXT,
        fetchedAt TEXT NOT NULL,
        observedAt TEXT NOT NULL,
        expiresAt TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        UNIQUE(connectionId, discoveryBatchId, canonicalId)
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS importSessions (
        id TEXT PRIMARY KEY,
        connectionId TEXT NOT NULL,
        discoveryBatchId TEXT,
        providerAlias TEXT NOT NULL,
        totalCount INTEGER NOT NULL DEFAULT 0,
        selectedCount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'preview',
        createdAt TEXT NOT NULL,
        committedAt TEXT,
        rollbackAt TEXT
      )
    `);
  },
};
export default migration;
