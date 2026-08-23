import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";

const aliasKv = makeKv("modelAliases");
const mappingKv = makeKv("modelMappings");
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

const mappingKey = (provider, upstreamModel) =>
  `${encodeURIComponent(provider)}|${encodeURIComponent(upstreamModel)}`;

const parseMappingKey = (key) => {
  const separator = key.indexOf("|");
  if (separator < 0) return null;
  return {
    provider: decodeURIComponent(key.slice(0, separator)),
    upstreamModel: decodeURIComponent(key.slice(separator + 1)),
  };
};

export async function getModelMappings() {
  const all = await mappingKv.getAll();
  return Object.entries(all).flatMap(([key, mappedModel]) => {
    const identity = parseMappingKey(key);
    return identity && typeof mappedModel === "string"
      ? [{ ...identity, mappedModel }]
      : [];
  });
}

export async function setModelMappings(mappings) {
  const normalized = (Array.isArray(mappings) ? mappings : [])
    .map((item) => ({
      provider: String(item?.provider || "").trim(),
      upstreamModel: String(item?.upstreamModel || "").trim(),
      mappedModel: String(item?.mappedModel || "").trim(),
    }))
    .filter((item) => item.provider && item.upstreamModel && item.mappedModel);
  await Promise.all(normalized.map((item) =>
    mappingKv.set(mappingKey(item.provider, item.upstreamModel), item.mappedModel),
  ));
  return normalized;
}

export async function deleteModelMapping(provider, upstreamModel) {
  await mappingKv.remove(mappingKey(provider, upstreamModel));
}

// customModels: key=`${providerAlias}|${id}|${type}`, value=full model object
function customKey(providerAlias, id, type) {
  return `${providerAlias}|${id}|${type}`;
}

export async function getCustomModels() {
  const all = await customKv.getAll();
  return Object.values(all);
}

// Atomic check-then-insert inside transaction to prevent duplicate races
export async function addCustomModel({ providerAlias, id, type = "llm", name }) {
  const k = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let added = false;
  db.transaction(() => {
    const row = db.get(`SELECT 1 FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (row) return;
    const value = stringifyJson({ providerAlias, id, type, name: name || id });
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
    added = true;
  });
  return added;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }) {
  await customKv.remove(customKey(providerAlias, id, type));
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
