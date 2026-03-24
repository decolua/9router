import { getProxyPoolById } from "@/models";

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled = providerSpecificData?.connectionProxyEnabled === true;
  const connectionProxyUrl = normalizeString(providerSpecificData?.connectionProxyUrl);
  const connectionNoProxy = normalizeString(providerSpecificData?.connectionNoProxy);

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

export async function resolveConnectionProxyConfig(providerSpecificData = {}) {
  const proxyPoolIdRaw = normalizeString(providerSpecificData?.proxyPoolId);
  const proxyPoolId = proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;
  const legacy = normalizeLegacyProxy(providerSpecificData);

  if (proxyPoolId) {
    const proxyPool = await getProxyPoolById(proxyPoolId);
    const proxyUrl = normalizeString(proxyPool?.proxyUrl);
    const noProxy = normalizeString(proxyPool?.noProxy);

    if (proxyPool && proxyPool.isActive === true && proxyUrl) {
      return {
        source: "pool",
        proxyPoolId,
        proxyPool,
        connectionProxyEnabled: true,
        connectionProxyUrl: proxyUrl,
        connectionNoProxy: noProxy,
        strictProxy: proxyPool.strictProxy === true,
      };
    }
  }

  if (legacy.connectionProxyEnabled && legacy.connectionProxyUrl) {
    return {
      source: "legacy",
      proxyPoolId: proxyPoolId || null,
      proxyPool: null,
      ...legacy,
    };
  }

  return {
    source: "none",
    proxyPoolId: proxyPoolId || null,
    proxyPool: null,
    ...legacy,
  };
}
