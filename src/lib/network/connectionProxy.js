import { getProxyPoolById, updateProviderConnection } from "@/models";

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

/**
 * Resolve proxy config for a connection, with round-robin across multiple pools.
 * @param {Object} providerSpecificData
 * @param {string|null} connectionId - Required to persist proxyPoolIndex rotation
 * @returns {Promise<Object>} Proxy config with connectionProxyEnabled, connectionProxyUrl, etc.
 */
export async function resolveConnectionProxyConfig(providerSpecificData = {}, connectionId = null) {
  const legacy = normalizeLegacyProxy(providerSpecificData);

  // Support both legacy single proxyPoolId and new proxyPoolIds array
  const rawPoolIds = providerSpecificData?.proxyPoolIds;
  // Handle null explicitly — normalizeString(null) would become "null" string
  const rawSingleId = providerSpecificData?.proxyPoolId ?? null;
  const singlePoolId = rawSingleId !== null ? normalizeString(rawSingleId) : "";

  let poolIds = [];
  if (Array.isArray(rawPoolIds) && rawPoolIds.length > 0) {
    poolIds = rawPoolIds.filter(Boolean);
  } else if (singlePoolId && singlePoolId !== "__none__") {
    poolIds = [singlePoolId];
  }

  if (poolIds.length > 0) {
    // Determine starting index for round-robin
    let poolIndex = providerSpecificData?.proxyPoolIndex || 0;
    if (poolIndex >= poolIds.length) poolIndex = 0;

    const proxyPoolId = poolIds[poolIndex];
    const proxyPool = await getProxyPoolById(proxyPoolId);
    const proxyUrl = normalizeString(proxyPool?.proxyUrl);
    const noProxy = normalizeString(proxyPool?.noProxy);

    if (proxyPool && proxyPool.isActive === true && proxyUrl) {
      // Persist next rotation index (advance for next request)
      if (connectionId) {
        const nextIndex = (poolIndex + 1) % poolIds.length;
        updateProviderConnection(connectionId, {
          providerSpecificData: { ...providerSpecificData, proxyPoolIndex: nextIndex }
        }).catch(() => { });
      }

      // Vercel relay: rewrite base URL instead of using HTTP_PROXY
      if (proxyPool.type === "vercel") {
        return {
          source: "vercel",
          proxyPoolId,
          proxyPool,
          connectionProxyEnabled: false,
          connectionProxyUrl: "",
          connectionNoProxy: noProxy,
          strictProxy: proxyPool.strictProxy === true,
          vercelRelayUrl: proxyUrl,
        };
      }

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
      proxyPoolId: poolIds[0] || singlePoolId || null,
      proxyPool: null,
      ...legacy,
    };
  }

  return {
    source: "none",
    proxyPoolId: poolIds[0] || singlePoolId || null,
    proxyPool: null,
    ...legacy,
  };
}
