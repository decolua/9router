import { TABLES, buildCreateTableSql } from "../schema.js";
import { detailMetadata } from "../../observability/logPrivacy.js";
import { parseJson } from "../helpers/jsonCol.js";

const migration = {
  version: 8,
  name: "log-privacy",
  up(db) {
    db.exec(buildCreateTableSql("auditLog", TABLES.auditLog));
    for (const idx of TABLES.auditLog.indexes) db.exec(idx);
    db.exec(buildCreateTableSql("requestDetails", TABLES.requestDetails));
    if (!db.all("PRAGMA table_info(requestDetails)").some(c => c.name === "bodyExpiresAt"))
      db.exec("ALTER TABLE requestDetails ADD COLUMN bodyExpiresAt TEXT");
    // Old rows have no authorized capture window. Preserve only their metadata.
    for (const row of db.all("SELECT * FROM requestDetails")) {
      const record = detailMetadata({ ...parseJson(row.data, {}), ...row });
      db.run("UPDATE requestDetails SET data=?, provider=?, model=?, connectionId=?, status=? WHERE id=?",
        [JSON.stringify(record), record.provider, record.model, record.connectionId, record.status, row.id]);
    }
    db.exec(buildCreateTableSql("settings", TABLES.settings));
    db.run("UPDATE settings SET data=json_remove(data,'$.debugBodyLoggingUntil') WHERE id=1 AND json_valid(data)");
  },
};

export default migration;
