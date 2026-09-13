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
  if ("systemPromptMode" in data) {
    out.systemPromptMode = (data.systemPromptMode === "override" || data.systemPromptMode === "append") ? data.systemPromptMode : "override";
  }
  return out;
}

/**
 * Pick + sanitize the hidden-thinking usage-synthesis fields from an API
 * payload. Present-but-invalid values become explicit null (allows clearing);
 * absent fields are omitted so updates keep stored values (merge semantics —
 * media-combo pages that PATCH only {name}/{models} can't wipe the config).
 */
export function sanitizeComboThinkingUsageFields(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  if ("thinkingUsageMode" in data) {
    const mode = data.thinkingUsageMode;
    out.thinkingUsageMode = (mode === "auto" || mode === "off" || mode === "always") ? mode : null;
  }
  const ratio = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : null);
  if ("thinkingUsageMinRatio" in data) out.thinkingUsageMinRatio = ratio(data.thinkingUsageMinRatio);
  if ("thinkingUsageMaxRatio" in data) out.thinkingUsageMaxRatio = ratio(data.thinkingUsageMaxRatio);
  return out;
}

// Coerce a stored ratio column to a safe number or null (legacy rows / raw
// SQL results can carry anything).
const toRatioOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    systemPromptEnabled: !!row.systemPromptEnabled,
    systemPrompt: row.systemPrompt || "",
    systemPromptMode: row.systemPromptMode === "append" ? "append" : "override",
    thinkingUsageMode: row.thinkingUsageMode || null,
    thinkingUsageMinRatio: toRatioOrNull(row.thinkingUsageMinRatio),
    thinkingUsageMaxRatio: toRatioOrNull(row.thinkingUsageMaxRatio),
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
    systemPromptMode: data.systemPromptMode === "append" ? "append" : "override",
    thinkingUsageMode: data.thinkingUsageMode || null,
    thinkingUsageMinRatio: toRatioOrNull(data.thinkingUsageMinRatio),
    thinkingUsageMaxRatio: toRatioOrNull(data.thinkingUsageMaxRatio),
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, systemPromptEnabled, systemPrompt, systemPromptMode, thinkingUsageMode, thinkingUsageMinRatio, thinkingUsageMaxRatio, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), systemPromptEnabled ? 1 : 0, combo.systemPrompt, combo.systemPromptMode, combo.thinkingUsageMode, combo.thinkingUsageMinRatio, combo.thinkingUsageMaxRatio, combo.createdAt, combo.updatedAt]
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
      `UPDATE combos SET name = ?, kind = ?, models = ?, systemPromptEnabled = ?, systemPrompt = ?, systemPromptMode = ?, thinkingUsageMode = ?, thinkingUsageMinRatio = ?, thinkingUsageMaxRatio = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.systemPromptEnabled === true || merged.systemPromptEnabled === 1 ? 1 : 0, merged.systemPrompt || "", merged.systemPromptMode === "append" ? "append" : "override", merged.thinkingUsageMode ?? null, merged.thinkingUsageMinRatio ?? null, merged.thinkingUsageMaxRatio ?? null, merged.updatedAt, id]
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
