// Migration 004: version existing proxy-pool fitness rows for conditional clears.
export default {
  version: 4,
  name: "version-proxy-pool-fitness",
  up(db) {
    const hasVersion = db.all("PRAGMA table_info(proxyPoolFitness)").some((column) => column.name === "version");
    if (!hasVersion) db.exec("ALTER TABLE proxyPoolFitness ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  },
};
