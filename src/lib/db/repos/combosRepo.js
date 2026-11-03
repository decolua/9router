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
    mirrorGroup: row.mirrorGroup || null,
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

export async function getCombosByMirrorGroup(mirrorGroup) {
  if (!mirrorGroup) return [];
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos WHERE mirrorGroup = ? ORDER BY createdAt ASC`, [mirrorGroup]);
  return rows.map(rowToCombo);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  let models = data.models || [];
  let kind = data.kind || null;
  const mirrorGroup = data.mirrorGroup || null;

  // If joining an existing mirror group, inherit models and kind to guarantee parity
  if (mirrorGroup) {
    const existing = db.all(`SELECT * FROM combos WHERE mirrorGroup = ? LIMIT 1`, [mirrorGroup]);
    if (existing.length > 0) {
      const peer = rowToCombo(existing[0]);
      if (peer) {
        models = peer.models;
        kind = peer.kind;
      }
    }
  }

  const combo = {
    id: uuidv4(),
    name: data.name,
    kind,
    models,
    mirrorGroup,
    createdAt: now,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO combos(id, name, kind, models, mirrorGroup, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.mirrorGroup, combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;

    const existing = rowToCombo(row);
    const targetMirrorGroup = data.mirrorGroup !== undefined ? data.mirrorGroup : existing.mirrorGroup;
    let targetModels = data.models !== undefined ? data.models : existing.models;
    let targetKind = data.kind !== undefined ? data.kind : existing.kind;

    // If combo was just assigned to an existing mirror group, adopt group policy if not explicitly overridden
    if (targetMirrorGroup && targetMirrorGroup !== existing.mirrorGroup && data.models === undefined) {
      const peerRow = db.get(`SELECT * FROM combos WHERE mirrorGroup = ? AND id != ? LIMIT 1`, [targetMirrorGroup, id]);
      if (peerRow) {
        const peer = rowToCombo(peerRow);
        targetModels = peer.models;
        targetKind = peer.kind;
      }
    }

    const now = new Date().toISOString();
    const merged = {
      ...existing,
      ...data,
      models: targetModels,
      kind: targetKind,
      mirrorGroup: targetMirrorGroup || null,
      updatedAt: now,
    };

    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, mirrorGroup = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.mirrorGroup, merged.updatedAt, id]
    );

    // Atomically propagate models and kind to all other members in the mirror group
    if (merged.mirrorGroup) {
      db.run(
        `UPDATE combos SET models = ?, kind = ?, updatedAt = ? WHERE mirrorGroup = ? AND id != ?`,
        [stringifyJson(merged.models || []), merged.kind, now, merged.mirrorGroup, id]
      );
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
