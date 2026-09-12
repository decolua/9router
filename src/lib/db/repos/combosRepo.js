import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export const MAX_COMBO_SYSTEM_PROMPT_CHARS = 4000;

/**
 * Pick + sanitize the identity-system-prompt fields from an API payload.
 * Absent fields are omitted so updates keep stored values (merge semantics).
 */
export function sanitizeComboSystemPromptFields(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  if (typeof data.systemPromptEnabled === "boolean") {
    out.systemPromptEnabled = data.systemPromptEnabled;
  }
  if (typeof data.systemPrompt === "string") {
    out.systemPrompt = data.systemPrompt.slice(0, MAX_COMBO_SYSTEM_PROMPT_CHARS).trim();
  }
  return out;
}

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    systemPromptEnabled: !!row.systemPromptEnabled,
    systemPrompt: row.systemPrompt || "",
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
  const systemPromptEnabled = data.systemPromptEnabled === true;
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    systemPromptEnabled,
    systemPrompt: data.systemPrompt || "",
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, systemPromptEnabled, systemPrompt, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), systemPromptEnabled ? 1 : 0, combo.systemPrompt, combo.createdAt, combo.updatedAt]
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
      `UPDATE combos SET name = ?, kind = ?, models = ?, systemPromptEnabled = ?, systemPrompt = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.systemPromptEnabled === true || merged.systemPromptEnabled === 1 ? 1 : 0, merged.systemPrompt || "", merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
