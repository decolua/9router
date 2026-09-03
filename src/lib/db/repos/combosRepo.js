import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToCombo(row) {
  if (!row) return null;
  const config = row.config ? parseJson(row.config, null) : null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    config: config || undefined,
    // Derived: members[] normalized from config or fallback to models
    members: Array.isArray(config?.members) ? config.members : parseJson(row.models, []).map((id) => ({ id, weight: 1 })),
    policy: config?.policy || undefined,
    accountPolicy: config?.accountPolicy || undefined,
    fusion: config?.fusion || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeConfig(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  if (Array.isArray(input.members)) out.members = input.members;
  if (input.policy && typeof input.policy === "object") out.policy = input.policy;
  if (input.accountPolicy && typeof input.accountPolicy === "object") out.accountPolicy = input.accountPolicy;
  if (input.fusion && typeof input.fusion === "object") out.fusion = input.fusion;
  if (input.capacity && typeof input.capacity === "object") out.capacity = input.capacity;
  return Object.keys(out).length ? out : null;
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
  let config = normalizeConfig(data.config);
  // If members provided (with or without config), merge them into config.members so
  // weights/policy survive round-trip instead of being dropped.
  let members = null;
  if (Array.isArray(data.members)) members = data.members;
  else if (Array.isArray(config?.members)) members = config.members;
  const models = Array.isArray(members) ? members.map((m) => typeof m === "string" ? m : m.id).filter(Boolean)
    : (data.models || []);
  if (Array.isArray(members)) {
    config = { ...(config || {}), members };
  }
  const effectiveConfig = config || null;
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models,
    config: effectiveConfig,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, config, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), effectiveConfig ? stringifyJson(effectiveConfig) : null, combo.createdAt, combo.updatedAt]
  );
  const cfg = combo.config || null;
  return {
    ...combo,
    members: cfg?.members || combo.models.map((id) => ({ id, weight: 1 })),
    policy: cfg?.policy || undefined,
    accountPolicy: cfg?.accountPolicy || undefined,
    fusion: cfg?.fusion || undefined,
  };
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToCombo(row);
    const hasConfigUpdate = data.config !== undefined || data.members !== undefined || data.policy !== undefined || data.accountPolicy !== undefined || data.fusion !== undefined;
    let nextConfig = existing.config || null;
    if (hasConfigUpdate) {
      if (data.config !== undefined) {
        nextConfig = normalizeConfig(data.config);
      } else {
        // Partial updates via top-level members/policy/etc
        const patch = { ...(nextConfig || {}) };
        if (data.members !== undefined) patch.members = data.members;
        if (data.policy !== undefined) patch.policy = data.policy;
        if (data.accountPolicy !== undefined) patch.accountPolicy = data.accountPolicy;
        if (data.fusion !== undefined) patch.fusion = data.fusion;
        if (data.capacity !== undefined) patch.capacity = data.capacity;
        nextConfig = normalizeConfig(patch);
      }
    }
    const nextModels = Array.isArray(data.models) ? data.models
      : Array.isArray(data.members) ? data.members.map((m) => typeof m === "string" ? m : m.id).filter(Boolean)
      : existing.models;
    // If members updated, sync models too
    if (Array.isArray(data.members) && !data.models) {
      // keep nextModels as derived
    }
    const merged = { ...existing, ...data, models: nextModels, config: nextConfig || undefined, updatedAt: new Date().toISOString() };
    // Ensure config.members stays in sync with models if config exists but members not updated
    if (merged.config && !Array.isArray(data.members) && Array.isArray(data.models)) {
      // Re-derive members from new models preserving weights where possible
      const oldMembers = new Map((existing.config?.members || []).map((m) => [m.id, m]));
      merged.config = { ...merged.config, members: merged.models.map((mid) => oldMembers.get(mid) || { id: mid, weight: 1 }) };
    }
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, config = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.config ? stringifyJson(merged.config) : null, merged.updatedAt, id]
    );
    result = { ...merged, members: merged.config?.members || merged.models.map((mId) => ({ id: mId, weight: 1 })) };
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
