import { qAll, qGet, qRun } from "../query.js";
import { getAdapter } from "../driver.js";
import { stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";
import { getRuntimeUserId } from "../../auth/runtimeUserContext.js";

function scopedUserId(userId) {
  return userId || getRuntimeUserId() || null;
}

function kv(userId) {
  const id = scopedUserId(userId);
  if (!id) throw new Error("userId is required");
  return {
    alias: makeKv("modelAliases", userId),
    custom: makeKv("customModels", userId),
    mitm: makeKv("mitmAlias", userId),
  };
}

function customKey(providerAlias, id, type) {
  return `${providerAlias}|${id}|${type}`;
}

function customScope(userId) {
  return makeKv("customModels", userId).scope;
}

// modelAliases: key=alias, value=modelString
export async function getModelAliases(userId) {
  return await kv(userId).alias.getAll();
}

export async function setModelAlias(userId, alias, model) {
  await kv(userId).alias.set(alias, model);
}

export async function deleteModelAlias(userId, alias) {
  await kv(userId).alias.remove(alias);
}

export async function getCustomModels(userId) {
  const all = await kv(userId).custom.getAll();
  return Object.values(all);
}

export async function addCustomModel(userId, { providerAlias, id, type = "llm", name }) {
  const k = customKey(providerAlias, id, type);
  const scope = customScope(userId);
  const db = await getAdapter();
  let added = false;
  db.transaction(() => {
    const row = db.get(`SELECT 1 FROM kv WHERE scope = ? AND key = ?`, [scope, k]);
    if (row) return;
    const value = stringifyJson({ providerAlias, id, type, name: name || id });
    db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)`, [scope, k, value]);
    added = true;
  });
  return added;
}

export async function deleteCustomModel(userId, { providerAlias, id, type = "llm" }) {
  await kv(userId).custom.remove(customKey(providerAlias, id, type));
}

export async function getMitmAlias(userId, toolName) {
  if (toolName) {
    const v = await kv(userId).mitm.get(toolName);
    return v || {};
  }
  return await kv(userId).mitm.getAll();
}

export async function setMitmAliasAll(userId, toolName, mappings) {
  await kv(userId).mitm.set(toolName, mappings || {});
}
