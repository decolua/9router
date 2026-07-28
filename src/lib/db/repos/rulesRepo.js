import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1 || row.enabled === true,
    priority: row.priority ?? 0,
    matchType: row.matchType || "literal",
    action: row.action || "replace",
    pattern: row.pattern,
    replacement: row.replacement || "",
    caseSensitive: row.caseSensitive === 1 || row.caseSensitive === true,
    providerIds: parseJson(row.providerIds, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getRules() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM convoyRules ORDER BY priority ASC, createdAt ASC`);
  return rows.map(rowToRule);
}

export async function getRuleById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM convoyRules WHERE id = ?`, [id]);
  return rowToRule(row);
}

export async function saveRule(rule) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const id = rule.id || uuidv4();

  const existing = db.get(`SELECT id FROM convoyRules WHERE id = ?`, [id]);
  if (existing) {
    db.run(
      `UPDATE convoyRules SET name=?, enabled=?, priority=?, matchType=?, action=?, pattern=?, replacement=?, caseSensitive=?, providerIds=?, updatedAt=? WHERE id=?`,
      [
        rule.name, rule.enabled ? 1 : 0, rule.priority ?? 0,
        rule.matchType || "literal", rule.action || "replace",
        rule.pattern, rule.replacement || "",
        rule.caseSensitive ? 1 : 0, stringifyJson(rule.providerIds || []), now, id,
      ]
    );
  } else {
    db.run(
      `INSERT INTO convoyRules(id, name, enabled, priority, matchType, action, pattern, replacement, caseSensitive, providerIds, createdAt, updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, rule.name, rule.enabled ? 1 : 0, rule.priority ?? 0,
        rule.matchType || "literal", rule.action || "replace",
        rule.pattern, rule.replacement || "",
        rule.caseSensitive ? 1 : 0, stringifyJson(rule.providerIds || []), now, now,
      ]
    );
  }
  return getRuleById(id);
}

export async function deleteRule(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM convoyRules WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function reorderRules(ids) {
  const db = await getAdapter();
  db.transaction(() => {
    for (let i = 0; i < ids.length; i++) {
      db.run(`UPDATE convoyRules SET priority = ? WHERE id = ?`, [i + 1, ids[i]]);
    }
  });
}
