// Consent audit log — records who accepted/revoked the experimental DLP
// consent (written server-side from /api/settings PATCH, immune to UI bypass).
// Additive table: also declared in schema.js TABLES so the auto-sync keeps
// fresh (via m001) and existing databases (via this migration) consistent.
export default {
  version: 2,
  name: "consent-log",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS consent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      hostname TEXT NOT NULL,
      action TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_consent_ts ON consent_log(createdAt DESC)");
  },
};