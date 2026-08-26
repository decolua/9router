import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { ensureDefaultComboList, DEFAULT_COMBO_LIST_ID } from "../migrations/004-combo-lists.js";

export { DEFAULT_COMBO_LIST_ID };

// DB-layer invariant: default list always exists, no combo ever points at a
// missing list. Runs cheaply on every repo touch.
async function withGuard(db) {
  const hasDefault = db.get(`SELECT id FROM comboLists WHERE id = ?`, [DEFAULT_COMBO_LIST_ID]);
  if (!hasDefault) {
    ensureDefaultComboList(db);
    db.run(`UPDATE combos SET listId = ? WHERE listId IS NULL OR listId = '' OR listId NOT IN (SELECT id FROM comboLists)`, [DEFAULT_COMBO_LIST_ID]);
  }
  return db;
}

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    kind: row.kind,
    models: parseJson(row.models, []),
    listId: row.listId || DEFAULT_COMBO_LIST_ID,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToList(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sortOrder || 0),
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
  const db = await withGuard(await getAdapter());
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    description: data.description || null,
    kind: data.kind || null,
    models: data.models || [],
    // Unknown/missing listId falls back to the default list — never an orphan.
    listId: DEFAULT_COMBO_LIST_ID,
    createdAt: now,
    updatedAt: now,
  };
  if (data.listId && db.get(`SELECT id FROM comboLists WHERE id = ?`, [data.listId])) {
    combo.listId = data.listId;
  }
  db.run(
    `INSERT INTO combos(id, name, description, kind, models, listId, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.description, combo.kind, stringifyJson(combo.models), combo.listId, combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await withGuard(await getAdapter());
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    // Guard against writes through updateCombo that would orphan a combo.
    if (!merged.listId || !db.get(`SELECT id FROM comboLists WHERE id = ?`, [merged.listId])) {
      merged.listId = row.listId || DEFAULT_COMBO_LIST_ID;
    }
    db.run(
      `UPDATE combos SET name = ?, description = ?, kind = ?, models = ?, listId = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.description || null, merged.kind, stringifyJson(merged.models || []), merged.listId, merged.updatedAt, id]
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

export async function deleteCombosByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const db = await getAdapter();
  let deleted = [];
  db.transaction(() => {
    deleted = ids.filter((id) => (db.run(`DELETE FROM combos WHERE id = ?`, [id])?.changes ?? 0) > 0);
  });
  return deleted;
}

// ─── Combo lists (page-only organization; does not affect runtime routing) ──

export async function getComboLists({ withCounts = false } = {}) {
  const db = await withGuard(await getAdapter());
  if (!withCounts) {
    return db.all(`SELECT * FROM comboLists ORDER BY sortOrder ASC, createdAt ASC`).map(rowToList);
  }
  return db
    .all(`SELECT l.*, COUNT(c.id) AS comboCount FROM comboLists l LEFT JOIN combos c ON c.listId = l.id GROUP BY l.id ORDER BY l.sortOrder ASC, l.createdAt ASC`)
    .map((row) => ({ ...rowToList(row), comboCount: Number(row.comboCount || 0) }));
}

export async function getComboListById(id) {
  const db = await withGuard(await getAdapter());
  return rowToList(db.get(`SELECT * FROM comboLists WHERE id = ?`, [id]));
}

export async function createComboList(name) {
  const db = await withGuard(await getAdapter());
  const max = Number(db.get(`SELECT COALESCE(MAX(sortOrder), -1) AS m FROM comboLists`)?.m ?? -1);
  const now = new Date().toISOString();
  const list = { id: uuidv4(), name, sortOrder: max + 1, createdAt: now, updatedAt: now };
  db.run(`INSERT INTO comboLists(id, name, sortOrder, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)`, [list.id, list.name, list.sortOrder, now, now]);
  return list;
}

export async function renameComboList(id, name) {
  const db = await withGuard(await getAdapter());
  const existing = db.get(`SELECT * FROM comboLists WHERE id = ?`, [id]);
  if (!existing) return null;
  db.run(`UPDATE comboLists SET name = ?, updatedAt = ? WHERE id = ?`, [name, new Date().toISOString(), id]);
  return { ...rowToList(existing), name };
}

export async function deleteComboList(id, { moveToDefault = true } = {}) {
  const db = await withGuard(await getAdapter());
  if (id === DEFAULT_COMBO_LIST_ID) {
    const error = new Error("默认清单不能删除");
    error.code = "LIST_PROTECTED";
    throw error;
  }
  let existed = false;
  db.transaction(() => {
    existed = !!db.get(`SELECT id FROM comboLists WHERE id = ?`, [id]);
    if (!existed) return;
    if (moveToDefault) {
      db.run(`UPDATE combos SET listId = ?, updatedAt = ? WHERE listId = ?`, [DEFAULT_COMBO_LIST_ID, new Date().toISOString(), id]);
    }
    db.run(`DELETE FROM comboLists WHERE id = ?`, [id]);
  });
  return existed;
}

// Compact sortOrders back to 0..n-1 per the current array order and persist.
// Never leaves gaps or duplicates behind.
export async function reorderComboLists(orderedIds) {
  const db = await withGuard(await getAdapter());
  const all = db.all(`SELECT id FROM comboLists`).map((r) => r.id);
  const valid = orderedIds.filter((id) => all.includes(id));
  const rest = all.filter((id) => !valid.includes(id));
  const finalOrder = [...new Set([...valid, ...rest])];
  const now = new Date().toISOString();
  db.transaction(() => {
    finalOrder.forEach((id, index) => {
      db.run(`UPDATE comboLists SET sortOrder = ?, updatedAt = ? WHERE id = ?`, [index, now, id]);
    });
  });
  return getComboLists();
}

export async function moveCombosToList(comboIds, listId) {
  const db = await withGuard(await getAdapter());
  const target = db.get(`SELECT id FROM comboLists WHERE id = ?`, [listId]);
  if (!target) return [];
  const ids = (Array.isArray(comboIds) ? comboIds : []).filter(Boolean);
  if (!ids.length) return [];
  let moved = [];
  db.transaction(() => {
    moved = ids.filter((id) => (db.run(`UPDATE combos SET listId = ?, updatedAt = ? WHERE id = ?`, [listId, new Date().toISOString(), id])?.changes ?? 0) > 0);
  });
  return moved;
}
