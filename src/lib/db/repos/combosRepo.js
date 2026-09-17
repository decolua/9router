import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { pruneMembers } from "@/shared/utils/comboModelLinks.js";

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
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Remove a model from every combo that uses it, and clear any fusion judge
 * naming it, in ONE transaction.
 *
 * A loop over updateCombo would be transactional per combo, so a failure
 * midway would leave some combos pruned and others not — a partial edit to
 * the user's saved routing. The judge lives in the settings row, which is in
 * the same database, so one transaction covers both.
 *
 * @param {string[]} candidates - every name form the model may be stored under
 * @returns {Promise<Array<{id, name, removed, remainingCount, judgeCleared}>>}
 */
export async function removeModelFromCombos(candidates) {
  const set = new Set((candidates || []).filter(Boolean));
  if (set.size === 0) return [];

  const db = await getAdapter();
  const summary = [];

  db.transaction(() => {
    const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
    const now = new Date().toISOString();
    const byName = new Map();

    for (const row of rows) {
      const combo = rowToCombo(row);
      byName.set(combo.name, combo);
      const { kept, removed } = pruneMembers(combo.models, set);
      if (removed.length === 0) continue;
      db.run(
        `UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?`,
        [stringifyJson(kept), now, combo.id]
      );
      summary.push({
        id: combo.id,
        name: combo.name,
        removed,
        remainingCount: kept.length,
        judgeCleared: false,
      });
    }

    const settingsRow = db.get(`SELECT data FROM settings WHERE id = 1`);
    const settings = settingsRow ? parseJson(settingsRow.data, {}) : {};
    const strategies = settings.comboStrategies;
    if (!strategies || typeof strategies !== "object") return;

    let strategiesChanged = false;
    for (const [comboName, config] of Object.entries(strategies)) {
      if (!config || !set.has(config.judgeModel)) continue;
      strategies[comboName] = { ...config, judgeModel: null };
      strategiesChanged = true;
      const existing = summary.find((entry) => entry.name === comboName);
      if (existing) {
        existing.judgeCleared = true;
      } else {
        const combo = byName.get(comboName);
        summary.push({
          id: combo?.id ?? null,
          name: comboName,
          removed: [],
          remainingCount: combo ? combo.models.length : null,
          judgeCleared: true,
        });
      }
    }

    if (strategiesChanged) {
      db.run(
        `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [stringifyJson({ ...settings, comboStrategies: strategies })]
      );
    }
  });

  return summary;
}
