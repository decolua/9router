const migration = {
  version: 3,
  name: "api-key-clients-last-seen-index",
  up(db) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_akc_last ON apiKeyClients(lastSeen DESC)");
  },
};

export default migration;
