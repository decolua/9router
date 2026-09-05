import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToPreset(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getKeyPresets() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM keyPresets ORDER BY createdAt ASC`);
  return rows.map(rowToPreset);
}

export async function getKeyPresetById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM keyPresets WHERE id = ?`, [id]);
  return rowToPreset(row);
}

export async function createKeyPreset(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const preset = {
    id: uuidv4(),
    name: data.name,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO keyPresets(id, name, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)`,
    [preset.id, preset.name, stringifyJson(preset.models), preset.createdAt, preset.updatedAt]
  );
  return preset;
}

export async function updateKeyPreset(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM keyPresets WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPreset(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE keyPresets SET name = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteKeyPreset(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM keyPresets WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
