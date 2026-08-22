import { createHash } from "node:crypto";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export const DEFAULT_API_KEY_GROUP_ID = "default";

function normalizedList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean))].sort();
}

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS apiKeyGroups (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    allowedModels TEXT NOT NULL,
    allowedCombos TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`);
  const columns = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((row) => row.name));
  if (!columns.has("groupId")) db.exec(`ALTER TABLE apiKeys ADD COLUMN groupId TEXT`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ak_group ON apiKeys(groupId)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_akg_name ON apiKeyGroups(name)`);
}

export function assignLegacyApiKeyGroups(db) {
  ensureSchema(db);
  const now = new Date().toISOString();
  db.run(
    `INSERT OR IGNORE INTO apiKeyGroups(id, name, allowedModels, allowedCombos, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [DEFAULT_API_KEY_GROUP_ID, "默认分组", stringifyJson([]), stringifyJson([]), now, now]
  );

  for (const row of db.all(`SELECT id, allowedModels, allowedCombos, groupId FROM apiKeys`)) {
    if (row.groupId && db.get(`SELECT id FROM apiKeyGroups WHERE id = ?`, [row.groupId])) continue;
    const allowedModels = normalizedList(parseJson(row.allowedModels, []));
    const allowedCombos = normalizedList(parseJson(row.allowedCombos, []));
    let groupId = DEFAULT_API_KEY_GROUP_ID;

    if (allowedModels.length || allowedCombos.length) {
      const signature = JSON.stringify({ allowedModels, allowedCombos });
      const digest = createHash("sha256").update(signature).digest("hex").slice(0, 12);
      groupId = `migrated-${digest}`;
      db.run(
        `INSERT OR IGNORE INTO apiKeyGroups(id, name, allowedModels, allowedCombos, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [groupId, `迁移分组-${digest.slice(0, 6)}`, stringifyJson(allowedModels), stringifyJson(allowedCombos), now, now]
      );
    }

    db.run(`UPDATE apiKeys SET groupId = ? WHERE id = ?`, [groupId, row.id]);
  }
}

export default {
  version: 2,
  name: "api-key-groups",
  up(db) {
    assignLegacyApiKeyGroups(db);
  },
};
