import { TABLES, buildCreateTableSql } from "../schema.js";
import { keyVerifier } from "../helpers/keyVerifier.js";

const migration = {
  version: 5,
  name: "key-verifiers",
  up(db) {
    db.transaction(() => {
      const columns = new Set(db.all("PRAGMA table_info(apiKeys)").map(c => c.name));
      for (const name of ["key_verifier", "key_version"]) {
        if (!columns.has(name)) db.exec(`ALTER TABLE apiKeys ADD COLUMN ${name} ${TABLES.apiKeys.columns[name]}`);
      }
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_key_verifier ON apiKeys(key_verifier)");
      db.exec(buildCreateTableSql("retiredKeyFingerprints", TABLES.retiredKeyFingerprints));
      for (const row of db.all("SELECT id, key FROM apiKeys WHERE key_verifier IS NULL")) {
        db.run("UPDATE apiKeys SET key_verifier=? WHERE id=? AND key_verifier IS NULL", [keyVerifier(row.key), row.id]);
      }
    });
  },
};

export default migration;
