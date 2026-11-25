import { TABLES } from "../schema.js";

export default {
  version: 2,
  name: "key-policy",
  up(db) {
    const existing = new Set(db.all("PRAGMA table_info(apiKeys)").map(({ name }) => name));
    for (const name of ["rpmLimit", "rpmMinute", "rpmUsed", "expiresAt"]) {
      if (!existing.has(name)) db.exec(`ALTER TABLE apiKeys ADD COLUMN ${name} ${TABLES.apiKeys.columns[name]}`);
    }
  },
};
