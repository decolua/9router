import { getProxyPoolById } from "@/lib/localDb";

function normalizeString(value: any): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

interface LegacyProxyConfig {
  connectionProxyEnabled: boolean;
  connectionProxyUrl: string;
  connectionNoProxy: string;
}

function normalizeLegacyProxy(providerSpecificData: any = {}): LegacyProxyConfig {
  const connectionProxyEnabled = providerSpecificData?.connectionProxyEnabled === true;
  const connectionProxyUrl = normalizeString(providerSpecificData?.connectionProxyUrl);
  const connectionNoProxy = normalizeString(providerSpecificData?.connectionNoProxy);

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

export interface ConnectionProxyConfig {
  source: "pool" | "vercel" | "legacy" | "none";
  proxyPoolId: string | null;
  proxyPool: any | null;
  connectionProxyEnabled: boolean;
  connectionProxyUrl: string;
  connectionNoProxy: string;
  strictProxy?: boolean;
  vercelRelayUrl?: string;
}

export async function resolveConnectionProxyConfig(providerSpecificData: any = {}): Promise<ConnectionProxyConfig> {
  const proxyPoolIdRaw = normalizeString(providerSpecificData?.proxyPoolId);
  const proxyPoolId = proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;
  const legacy = normalizeLegacyProxy(providerSpecificData);

  if (proxyPoolId) {
    const proxyPool = await getProxyPoolById(proxyPoolId);
    const proxyUrl = normalizeString(proxyPool?.proxyUrl);
    const noProxy = normalizeString(proxyPool?.noProxy);

    if (proxyPool && proxyPool.isActive === true && proxyUrl) {
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
