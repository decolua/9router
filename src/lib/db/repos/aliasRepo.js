import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";
import { resolveNodeIdByPrefix } from "./nodesRepo.js";

const aliasKv = makeKv("modelAliases");
const customKv = makeKv("customModels");
const mitmKv = makeKv("mitmAlias");

// modelAliases: key=alias, value=modelString
export async function getModelAliases() {
  return await aliasKv.getAll();
}

export async function setModelAlias(alias, model) {
  await aliasKv.set(alias, model);
}

export async function deleteModelAlias(alias) {
  await aliasKv.remove(alias);
}

// customModels: key=`${providerAlias}|${id}|${type}`, value=full model object
function customKey(providerAlias, id, type) {
  return `${providerAlias}|${id}|${type}`;
}

export async function getCustomModels() {
  const all = await customKv.getAll();
  return Object.values(all);
}

// Atomic upsert inside transaction to prevent duplicate races.
// Re-adding an existing model updates caps/name without resetting omitted fields.
export async function addCustomModel({ providerAlias, id, type = "llm", name, caps }) {
  const k = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let added = false;
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (row) {
      const prev = parseJson(row.value) || {};
      const next = { ...prev, ...(name ? { name } : {}), ...(caps ? { caps } : {}) };
      db.run(`UPDATE kv SET value = ? WHERE scope = 'customModels' AND key = ?`, [stringifyJson(next), k]);
      return;
    }
    const record = { providerAlias, id, type, name: name || id };
    // Persist user-declared capabilities (vision/reasoning/...) when provided so
    // the runtime resolver can lift the model above the text-only default.
    if (caps && typeof caps === "object") record.caps = caps;
    const value = stringifyJson(record);
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
    added = true;
  });
  return added;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }) {
  await customKv.remove(customKey(providerAlias, id, type));
}

// Edit a custom model in place. Supports renaming the id (rename = remove old
// key + insert new) and replacing caps/name. Atomic inside a transaction.
// Returns { updated, error }. Fails when the target id already exists (rename
// collision) or the source model is missing.
export async function updateCustomModel({ providerAlias, id, newId, type = "llm", name, caps }) {
  const finalId = (newId && newId !== id) ? newId : id;
  const oldKey = customKey(providerAlias, id, type);
  const newKey = customKey(providerAlias, finalId, type);
  const db = await getAdapter();
  let result = { updated: false, error: null };
  db.transaction(() => {
    const oldRow = db.get(`SELECT value FROM kv WHERE scope = 'customModels' AND key = ?`, [oldKey]);
    if (!oldRow) { result.error = "Model not found"; return; }
    if (newKey !== oldKey) {
      const clash = db.get(`SELECT 1 FROM kv WHERE scope = 'customModels' AND key = ?`, [newKey]);
      if (clash) { result.error = "A model with that id already exists"; return; }
    }
    const prev = parseJson(oldRow.value, {}) || {};
    const record = { providerAlias, id: finalId, type, name: name || finalId };
    if (caps && typeof caps === "object") record.caps = caps;
    else if (prev.caps && typeof prev.caps === "object" && caps === undefined) record.caps = prev.caps;
    if (newKey !== oldKey) db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [oldKey]);
    db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [newKey, stringifyJson(record)]);
    result.updated = true;
  });
  return result;
}

// Bulk-remove every custom model registered under a provider alias (all types
// unless `type` is given). Returns the number of rows deleted.
export async function deleteCustomModelsByProvider(providerAlias, type = null) {
  if (!providerAlias) return 0;
  const db = await getAdapter();
  let count = 0;
  db.transaction(() => {
    const prefix = `${providerAlias}|`;
    const rows = db.all(`SELECT key FROM kv WHERE scope = 'customModels' AND key LIKE ?`, [`${prefix}%`]);
    for (const r of rows) {
      // key = providerAlias|id|type — match provider exactly and (optionally) type.
      const parts = r.key.split("|");
      const rowType = parts[parts.length - 1];
      if (parts[0] !== providerAlias) continue;
      if (type && rowType !== type) continue;
      db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [r.key]);
      count += 1;
    }
  });
  return count;
}

// Return the stored capability overrides ({vision, reasoning, ...}) for a custom
// model, or null when the model isn't a custom model or carries no caps. Looked
// up by providerAlias + id (the LLM type — vision/reasoning apply to chat models).
// Compatible-provider aliases resolve to the node id first (rows are stored under
// the node id, but model strings use the display prefix). Fail-open: any DB error
// resolves to null so routing is never blocked.
export async function getCustomModelCaps(providerAlias, id) {
  if (!providerAlias || !id) return null;
  try {
    const resolved = await resolveNodeIdByPrefix(providerAlias);
    const raw = await customKv.get(customKey(resolved, id, "llm"));
    return raw && raw.caps && typeof raw.caps === "object" ? raw.caps : null;
  } catch {
    return null;
  }
}

// mitmAlias: key=toolName, value=mappings object
export async function getMitmAlias(toolName) {
  if (toolName) {
    const v = await mitmKv.get(toolName);
    return v || {};
  }
  return await mitmKv.getAll();
}

export async function setMitmAliasAll(toolName, mappings) {
  await mitmKv.set(toolName, mappings || {});
}
