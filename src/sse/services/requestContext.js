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
  return getCachedValue(requestContext, `combo:${name}`, () =>
    getComboByName(name).then((combo) => combo || null)
  );
}

export async function getRequestModelAliases(requestContext) {
  return getCachedValue(requestContext, "modelAliasesPromise", () => getModelAliases());
}
