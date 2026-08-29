/**
 * Add seenModels table for New Models discovery feature.
 * Tracks first-seen / acknowledged state for models across all providers.
 */
import { buildCreateTableSql } from "../schema.js";

const migration = {
  version: 2,
  name: "add-seen-models",
  up(db) {
    db.exec(
      buildCreateTableSql("seenModels", {
        columns: {
          id: "TEXT PRIMARY KEY",
          providerAlias: "TEXT NOT NULL",
          modelId: "TEXT NOT NULL",
          isFree: "INTEGER DEFAULT 0",
          firstSeenAt: "TEXT NOT NULL",
          acknowledged: "INTEGER DEFAULT 0",
        },
      })
    );
    db.exec("CREATE INDEX IF NOT EXISTS idx_sm_provider ON seenModels(providerAlias)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sm_unseen ON seenModels(acknowledged)");
  },
};

export default migration;
