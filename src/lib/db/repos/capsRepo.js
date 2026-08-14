import { makeKv } from "../helpers/kvStore.js";

// modelCaps: key=`${provider}|${model}`, value=capabilities override object.
// Overrides are merged over static open-sse capabilities at the src layer
// (GET /api/models) — the runtime engine keeps its static fallback.
const capsKv = makeKv("modelCaps");

export function capsKey(provider, model) {
  return `${provider}|${model}`;
}

export async function getCapsOverrides() {
  return await capsKv.getAll();
}

export async function getCapsOverride(provider, model) {
  return await capsKv.get(capsKey(provider, model));
}

export async function setCapsOverride(provider, model, caps) {
  await capsKv.set(capsKey(provider, model), caps);
}

export async function deleteCapsOverride(provider, model) {
  await capsKv.remove(capsKey(provider, model));
}

// entries: { [modelId]: caps } for one provider — single transaction
export async function setCapsOverridesBulk(provider, entries) {
  const obj = {};
  for (const [model, caps] of Object.entries(entries)) {
    obj[capsKey(provider, model)] = caps;
  }
  await capsKv.setMany(obj);
}
