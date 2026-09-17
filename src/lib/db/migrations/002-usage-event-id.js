export default {
  version: 2,
  name: "usage-event-id",
  up(db) {
    const cols = db.all("PRAGMA table_info(usageHistory)");
    const hasUsageEventId = cols.some((c) => c.name === "usageEventId");
    if (!hasUsageEventId) {
      db.exec("ALTER TABLE usageHistory ADD COLUMN usageEventId TEXT");
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_uh_event ON usageHistory(usageEventId) WHERE usageEventId IS NOT NULL");
  },
};
