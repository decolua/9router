import { TABLES } from "../schema.js";
import { REQUEST_WINDOWS } from "../../../shared/utils/requestWindows.js";

export default {
  version: 4, name: "calendar-request-quotas",
  up(db) {
    const existing = new Set(db.all("PRAGMA table_info(apiKeys)").map(c => c.name));
    for (const w of REQUEST_WINDOWS.slice(1)) {
      for (const name of [w.limit, w.bucket, w.used]) {
        if (!existing.has(name)) db.exec(`ALTER TABLE apiKeys ADD COLUMN ${name} ${TABLES.apiKeys.columns[name]}`);
      }
    }
  },
};
