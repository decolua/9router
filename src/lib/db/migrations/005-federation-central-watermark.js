// Federation central-advertised watermark column (FED-021) — version 5.
//
// Adds federation_meta.centralMaxVersion: the maxVersion the CENTRAL last
// advertised in a snapshot/delta payload, persisted by applyRevisionBatch
// whenever a batch applies. revisionLag is measured against THIS value —
// the edge's LOCAL watermark (computeWatermark over its own replica rows)
// equals lastAppliedRevision by construction after FED-020, so a lag
// computed from it is structurally always 0 and a stale edge looked
// healthy.
//
// Idempotency: guarded PRAGMA table_info ADD COLUMN (same pattern as
// 002/003/004) so re-apply is safe on every SQLite adapter (bun:sqlite,
// better-sqlite3, node:sqlite, sql.js).
export default {
  version: 5,
  name: "federation-central-watermark",
  up(db) {
    const metaCols = db.all(`PRAGMA table_info(federation_meta)`);
    if (!metaCols.some((c) => c.name === "centralMaxVersion")) {
      db.exec(`ALTER TABLE federation_meta ADD COLUMN centralMaxVersion INTEGER`);
    }
  },
};
