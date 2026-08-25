import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    tools: parseJson(row.tools, null),
    maxTools: row.maxTools !== undefined ? row.maxTools : null,
    isActive: row.isActive === 1,
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
    tools: data.tools || null,
    maxTools: data.maxTools !== undefined ? data.maxTools : null,
    isActive: data.isActive ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  };
  db.transaction(() => {
    if (combo.kind === "mcp" && combo.isActive) {
      db.run(`UPDATE combos SET isActive = 0 WHERE kind = 'mcp'`);
    }
    db.run(
      `INSERT INTO combos(id, name, kind, models, tools, maxTools, isActive, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        combo.id,
        combo.name,
        combo.kind,
        stringifyJson(combo.models),
        combo.tools ? stringifyJson(combo.tools) : null,
        combo.maxTools,
        combo.isActive,
        combo.createdAt,
        combo.updatedAt
      ]
    );
  });
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    
    // Filter out undefined values to prevent overwriting columns with NULL
    const cleanData = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        cleanData[key] = val;
      }
    }

    const merged = { ...rowToCombo(row), ...cleanData, updatedAt: new Date().toISOString() };
    if (merged.kind === "mcp" && merged.isActive) {
      db.run(`UPDATE combos SET isActive = 0 WHERE kind = 'mcp' AND id != ?`, [id]);
    }
    try {
      db.run(
        `UPDATE combos SET name = ?, kind = ?, models = ?, tools = ?, maxTools = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
        [
          merged.name,
          merged.kind,
          stringifyJson(merged.models || []),
          merged.tools ? stringifyJson(merged.tools) : null,
          merged.maxTools !== undefined ? merged.maxTools : null,
          merged.isActive ? 1 : 0,
          merged.updatedAt,
          id
        ]
      );
    } catch (err) {
      console.error("[DB][updateCombo] SQLITE_CONSTRAINT_NOTNULL details:", {
        id,
        data,
        cleanData,
        merged,
        param_name: merged.name,
        param_kind: merged.kind,
        param_models: stringifyJson(merged.models || []),
        param_tools: merged.tools ? stringifyJson(merged.tools) : null,
        param_maxTools: merged.maxTools !== undefined ? merged.maxTools : null,
        param_isActive: merged.isActive ? 1 : 0,
        param_updatedAt: merged.updatedAt,
      });
      throw err;
    }
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
