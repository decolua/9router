import { getSettings, getProviderNodes, getComboByName, getModelAliases } from "../../lib/localDb.js";

function getCachedValue(requestContext, key, loader) {
  if (!requestContext) {
    return loader();
  }

  if (!requestContext[key]) {
    requestContext[key] = loader();
  }

  return requestContext[key];
}

export function createRequestContext() {
  return {};
}

export async function getRequestSettings(requestContext) {
  return getCachedValue(requestContext, "settingsPromise", () => getSettings());
}

export async function getRequestProviderNodes(type, requestContext) {
  const nodes = await getCachedValue(requestContext, "providerNodesPromise", () => getProviderNodes());
  if (!type) return nodes;
  return nodes.filter((node) => node.type === type);
}

export async function getRequestComboByName(name, requestContext) {
  const combosByName = await getCachedValue(requestContext, "combosByNamePromise", async () => new Map());

  if (combosByName.has(name)) {
    return combosByName.get(name);
  }

  const comboPromise = getComboByName(name).then((combo) => {
    combosByName.set(name, combo || null);
    return combo || null;
  });

  combosByName.set(name, comboPromise);
  return comboPromise;
}

export async function getRequestModelAliases(requestContext) {
  return getCachedValue(requestContext, "modelAliasesPromise", () => getModelAliases());
}
