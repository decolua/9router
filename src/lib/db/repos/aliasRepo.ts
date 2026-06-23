import type { JsonValue } from "open-sse/types/executor.js";
import { getAdapter } from "../driver.js";
import { stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";

const aliasKv = makeKv("modelAliases");
const customKv = makeKv("customModels");
const mitmKv = makeKv("mitmAlias");

// modelAliases: key=alias, value=modelString
export async function getModelAliases() {
  return await aliasKv.getAll();
}

export async function setModelAlias(alias: string, model: string) {
  await aliasKv.set(alias, model);
}

export async function deleteModelAlias(alias: string) {
  await aliasKv.remove(alias);
}

// customModels: key=`${providerAlias}|${id}|${type}`, value=full model object
function customKey(providerAlias: string, id: string, type: string) {
  return `${providerAlias}|${id}|${type}`;
}

export async function getCustomModels() {
  const all = await customKv.getAll();
  return Object.values(all);
}

// Atomic check-then-insert inside transaction to prevent duplicate races
export async function addCustomModel({
  providerAlias,
  id,
  type = "llm",
  name,
  vision,
}: {
  providerAlias: string;
  id: string;
  type?: string;
  name?: string;
  vision?: boolean;
}) {
  const k = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let added = false;
  db.transaction(() => {
    const row = db.get(`SELECT 1 FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (row) return;
    const value = stringifyJson({ providerAlias, id, type, name: name ?? id, vision: !!vision });
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
    added = true;
  });
  return added;
}

export async function deleteCustomModel({
  providerAlias,
  id,
  type = "llm",
}: {
  providerAlias: string;
  id: string;
  type?: string;
}) {
  await customKv.remove(customKey(providerAlias, id, type));
}

// mitmAlias: key=toolName, value=mappings object
export async function getMitmAlias(toolName?: string) {
  if (toolName) {
    const v = await mitmKv.get(toolName);
    return v ?? {};
  }
  return await mitmKv.getAll();
}

export async function setMitmAliasAll(toolName: string, mappings: Record<string, unknown>) {
  await mitmKv.set(toolName, mappings as JsonValue ?? {});
}
