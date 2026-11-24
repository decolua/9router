import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { normalizeAllowList } from "@/shared/utils/keyAccess.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  return rowToCombo(row);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  return db.transaction(() => {
    const combo = db.get(`SELECT name FROM combos WHERE id = ?`, [id]);
    if (!combo) return false;

    const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
    if (!(res?.changes > 0)) return false;

    // Grants identify combos by name, not DB id, and match case-insensitively.
    // Keep a grant if another case variant of the same combo name still exists.
    const name = combo.name.toLowerCase();
    if (db.all(`SELECT name FROM combos`).some((c) => c.name.toLowerCase() === name)) return true;

    // An orphan name can otherwise resolve as a model alias/provider, or grant a
    // newly created combo with the same name. Revoke it in the same transaction.
    const keys = db.all(`SELECT id, accessAllow FROM apiKeys WHERE accessRestricted = 1`);
    for (const key of keys) {
      const allow = normalizeAllowList(parseJson(key.accessAllow, []));
      const remaining = allow.filter((entry) => entry.toLowerCase() !== name);
      if (remaining.length === allow.length) continue;
      // Never clear accessRestricted: an empty allow list must still deny all.
      db.run(`UPDATE apiKeys SET accessAllow = ? WHERE id = ?`, [stringifyJson(remaining), key.id]);
    }
    return true;
  });
}
