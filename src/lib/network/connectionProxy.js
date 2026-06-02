import { getProxyPoolById } from "@/models";
import { getSettings } from "@/lib/localDb";

// Safely normalize any value into a trimmed string.
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl = normalizeString(
    providerSpecificData?.connectionProxyUrl,
  );

  const connectionNoProxy = normalizeString(
    providerSpecificData?.connectionNoProxy,
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool
 * 2. Legacy Proxy
 * 3. No Proxy
 */
export async function resolveConnectionProxyConfig(providerSpecificData = {}) {
  try {
    const settings = await getSettings();
    const proxyHeadersTimeout = Number(settings?.connectionProxyHeadersTimeoutMs) || undefined;
    const proxyPoolIdRaw = normalizeString(providerSpecificData?.proxyPoolId);

    // "__none__" means explicitly disabled
    const proxyPoolId = proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (proxyPoolId) {
      const proxyPool = await getProxyPoolById(proxyPoolId);

      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);

      const isValidPool = proxyPool && proxyPool.isActive === true && proxyUrl;

      if (isValidPool) {
        /**
         * Vercel/Cloudflare relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
        if (
          proxyPool.type === "vercel" ||
          proxyPool.type === "cloudflare" ||
          proxyPool.type === "deno"
        ) {
          return {
            source: proxyPool.type,

            proxyPoolId,
            proxyPool,

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: proxyPool.strictProxy === true,

            vercelRelayUrl: proxyUrl, // Still mapped to vercelRelayUrl in the unified payload since they use the exact same header spec
            connectionProxyHeadersTimeoutMs: proxyHeadersTimeout,
          };
        }

        /**
         * Standard proxy pool
         */
        return {
          source: "pool",

          proxyPoolId,
          proxyPool,

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: proxyPool.strictProxy === true,
          connectionProxyHeadersTimeoutMs: proxyHeadersTimeout,
        };
      }
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (legacy.connectionProxyEnabled && legacy.connectionProxyUrl) {
      return {
        source: "legacy",

        proxyPoolId: proxyPoolId || null,
        proxyPool: null,

        ...legacy,
        connectionProxyHeadersTimeoutMs: proxyHeadersTimeout,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
    return {
      source: "none",

      proxyPoolId: proxyPoolId || null,
      proxyPool: null,

      ...legacy,
      connectionProxyHeadersTimeoutMs: proxyHeadersTimeout,
    };
  } catch (error) {
    console.error(
      "[resolveConnectionProxyConfig] Failed to resolve proxy config:",
      error,
    );

    return {
      source: "error",

      proxyPoolId: null,
      proxyPool: null,

      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",

      strictProxy: false,
      connectionProxyHeadersTimeoutMs: undefined,
    };
  }
}
