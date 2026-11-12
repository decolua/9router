import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { nowIso, stampInsert, stampUpdate, stampDelete, NOT_DELETED } from "../../federation/stamp.js";

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
  const rows = db.all(`SELECT * FROM combos WHERE ${NOT_DELETED} ORDER BY createdAt ASC`);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ? AND ${NOT_DELETED}`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ? AND ${NOT_DELETED}`, [name]);
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
  const s = stampInsert(db);
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt${s.cols}) VALUES(?, ?, ?, ?, ?, ?${s.placeholders})`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt, ...s.params]
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
    const u = stampUpdate(db);
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ?${u.set} WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, ...u.params, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const d = stampDelete(db);
  const res = db.run(`UPDATE combos SET ${d.set} WHERE id = ?`, [...d.params, id]);
  return (res?.changes ?? 0) > 0;
}
