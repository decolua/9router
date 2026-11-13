// No-auth providers have no stored connection. Only draw them once they have
// actual usage in the selected period, not just because they are in the catalog.
export function addUsedFreeProviders(connections, freeProviders, usageByProvider, isLLMProvider) {
  const seen = new Set(connections.map((connection) => connection.provider));
  const used = Object.values(freeProviders)
    .filter((provider) => provider.noAuth && !provider.hidden && !seen.has(provider.id)
      && isLLMProvider(provider.id) && (usageByProvider?.[provider.id]?.requests || 0) > 0)
    .map((provider) => ({ provider: provider.id, name: provider.name }));
  return [...connections, ...used];
}
