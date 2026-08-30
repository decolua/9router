export default Object.freeze({
  version: 2,

  name:
    "routing-feedback-persistence",

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS routingFeedbackEvents (
        id TEXT PRIMARY KEY,
        observedAt TEXT NOT NULL,
        routeKind TEXT NOT NULL,
        comboName TEXT NOT NULL,
        strategy TEXT NOT NULL,
        candidateModel TEXT NOT NULL,
        attemptIndex INTEGER NOT NULL,
        attemptCount INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        status INTEGER,
        isWinner INTEGER NOT NULL DEFAULT 0,
        fallbackEligible INTEGER NOT NULL DEFAULT 0,
        durationMs REAL
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rfe_combo_ts
      ON routingFeedbackEvents(
        comboName,
        observedAt DESC
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rfe_model_ts
      ON routingFeedbackEvents(
        candidateModel,
        observedAt DESC
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rfe_ts
      ON routingFeedbackEvents(
        observedAt DESC
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS routingFeedbackStates (
        comboName TEXT NOT NULL,
        candidateModel TEXT NOT NULL,
        state TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (
          comboName,
          candidateModel
        )
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rfs_updated
      ON routingFeedbackStates(
        updatedAt DESC
      )
    `);
  },
});
