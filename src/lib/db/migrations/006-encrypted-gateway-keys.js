import { redactDailyKeys, usageIdentity } from "../helpers/usageFingerprint.js";
import { TABLES, buildCreateTableSql } from "../schema.js";
import { initializeEncryption, encryptKey } from "../helpers/keyEncryption.js";
import { keyVerifier, stampVerifierSecret } from "../helpers/keyVerifier.js";
import { FatalStartupError } from "../fatalStartupError.js";

// Kept across crashes between the schema commit and physical page cleanup.
export function finishKeyCleanup(db) {
  if (!db.get("SELECT 1 FROM _meta WHERE key='gatewayKeyCleanupPending'")) return;
  db.exec("VACUUM");
  if (db.driver !== "sql.js" && db.get("PRAGMA wal_checkpoint(TRUNCATE)").busy)
    throw new Error("Gateway key cleanup blocked by an active SQLite connection; retry startup");
  db.run("DELETE FROM _meta WHERE key='gatewayKeyCleanupPending'");
  db.flush?.();
}

function redactLegacyUsage(db) {
  const hasTable = name => db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?", [name]);
  if (hasTable("usageHistory")) {
    let after = 0;
    for (;;) {
      const rows = db.all(`SELECT id,apiKey FROM usageHistory WHERE id>? AND apiKey IS NOT NULL
        AND NOT (length(apiKey)=70 AND substr(apiKey,1,6)='usage:' AND substr(apiKey,7) NOT GLOB '*[^0-9a-f]*')
        ORDER BY id LIMIT 512`, [after]);
      if (!rows.length) break;
      for (const row of rows) db.run("UPDATE usageHistory SET apiKey=? WHERE id=?", [usageIdentity(row.apiKey), row.id]);
      after = rows.at(-1).id;
    }
  }
  if (hasTable("usageDaily")) {
    for (const { dateKey, data } of db.all("SELECT dateKey,data FROM usageDaily")) {
      let day;
      try { day = JSON.parse(data); } catch { throw new Error("Invalid usageDaily JSON during gateway key migration"); }
      if (redactDailyKeys(day)) db.run("UPDATE usageDaily SET data=? WHERE dateKey=?", [JSON.stringify(day), dateKey]);
    }
  }
}

const migration = {
  version: 6,
  name: "encrypted-gateway-keys",
  requiresBackup: true,
  managesTransaction: true,
  up(db, stamp = () => {}) {
    const fk = db.get("PRAGMA foreign_keys").foreign_keys;
    db.exec("PRAGMA foreign_keys=OFF");
    try {
      db.transaction(() => {
        const columns = db.all("PRAGMA table_info(apiKeys)").map(c => c.name);
        if (!columns.includes("key")) {
          if (!columns.includes("key_ciphertext")) throw new FatalStartupError("Unsupported apiKeys schema");
          stamp();
          return;
        }
        initializeEncryption(db);
        const retained = columns.filter(c => c !== "key");
        if (!retained.every(c => Object.hasOwn(TABLES.apiKeys.columns, c) && c !== "key_ciphertext"))
          throw new FatalStartupError("Unexpected apiKeys columns; refusing destructive migration");
        const objects = db.all(`SELECT sql FROM sqlite_schema WHERE tbl_name='apiKeys'
          AND type IN ('index','trigger') AND sql IS NOT NULL AND name NOT IN ('idx_ak_key','idx_key_verifier')`);
        db.exec(buildCreateTableSql("apiKeys_new", TABLES.apiKeys).replace(" IF NOT EXISTS", ""));
        const insert = `INSERT INTO apiKeys_new (${[...retained, "key_ciphertext"]}) VALUES (${Array(retained.length + 1).fill("?")})`;
        for (const row of db.all("SELECT * FROM apiKeys")) {
          row.key_verifier = keyVerifier(row.key);
          db.run(insert, [...retained.map(c => row[c]), encryptKey(db, row.id, row.key_version, row.key)]);
        }
        redactLegacyUsage(db);
        db.exec("DROP TABLE apiKeys");
        db.exec("ALTER TABLE apiKeys_new RENAME TO apiKeys");
        for (const sql of TABLES.apiKeys.indexes) db.exec(sql);
        for (const obj of objects) db.exec(obj.sql);
        if (db.all("PRAGMA foreign_key_check").length) throw new Error("Foreign key check failed during gateway key migration");
        stampVerifierSecret(db);
        db.run("INSERT OR REPLACE INTO _meta VALUES('gatewayKeyCleanupPending','1')");
        stamp();
      });
    } finally { db.exec("PRAGMA foreign_keys=" + (fk ? "ON" : "OFF")); }
    finishKeyCleanup(db);
  },
};

export default migration;
