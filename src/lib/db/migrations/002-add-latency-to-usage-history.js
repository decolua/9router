// Migration v2: Add latency columns to usageHistory (idempotent for fresh DBs)
export default {
  version: 2,
  name: "add-latency-to-usage-history",
  up(db) {
    const cols = db.all(`PRAGMA table_info(usageHistory)`).map(c => c.name);
    if (!cols.includes("ttft")) {
      db.exec(`ALTER TABLE usageHistory ADD COLUMN ttft INTEGER DEFAULT 0`);
    }
    if (!cols.includes("totalLatency")) {
      db.exec(`ALTER TABLE usageHistory ADD COLUMN totalLatency INTEGER DEFAULT 0`);
    }
  },
};