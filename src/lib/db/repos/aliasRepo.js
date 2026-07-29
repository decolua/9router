import { makeKv } from "../helpers/kvStore.js";
import { getRuntimeUserId } from "../../auth/runtimeUserContext.js";
import { resolveOrgId } from "../helpers/orgScope.js";
import { stringifyJson } from "../helpers/jsonCol.js";
import { getAdapter } from "../driver.js";

function scopedUserId(userId) {
  return userId || getRuntimeUserId() || null;
}

async function kv(userId) {
  const id = scopedUserId(userId);
  if (!id) throw new Error("userId is required");
  const orgId = await resolveOrgId();
  return {
    alias: makeKv("modelAliases", id, orgId),
    custom: makeKv("customModels", id, orgId),
    mitm: makeKv("mitmAlias", id, orgId),
  };
}

function customKey(providerAlias, id, type) {
  return `${providerAlias}|${id}|${type}`;
}

async function customScope(userId) {
  const store = await kv(userId);
  return store.custom.scope;
}

export async function getModelAliases(userId) {
  return (await kv(userId)).alias.getAll();
}

export async function setModelAlias(userId, alias, model) {
  await (await kv(userId)).alias.set(alias, model);
}

export async function deleteModelAlias(userId, alias) {
  await (await kv(userId)).alias.remove(alias);
}

export async function getCustomModels(userId) {
  const all = await (await kv(userId)).custom.getAll();
  return Object.values(all);
}

export async function addCustomModel(userId, { providerAlias, id, type = "llm", name }) {
  const k = customKey(providerAlias, id, type);
  const scope = await customScope(userId);
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
  await (await kv(userId)).custom.remove(customKey(providerAlias, id, type));
}

export async function getMitmAlias(userId, toolName) {
  const store = await kv(userId);
  if (toolName) {
    const v = await store.mitm.get(toolName);
    return v || {};
  }
  return store.mitm.getAll();
}

export async function setMitmAliasAll(userId, toolName, mappings) {
  await (await kv(userId)).mitm.set(toolName, mappings || {});
}
