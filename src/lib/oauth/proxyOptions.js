import "open-sse/utils/proxyFetch.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

export async function proxyOptionsForPool(proxyPoolId) {
  if (!proxyPoolId || proxyPoolId === "__none__") return { disableEnvProxy: true };
  const proxyConfig = await resolveConnectionProxyConfig({ proxyPoolId });
  if (!proxyConfig || proxyConfig.proxyUnavailable === true || ["none", "error", "unavailable"].includes(proxyConfig.source)) {
    throw new Error(`Proxy pool ${proxyPoolId} is unavailable`);
  }
  return {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: proxyConfig.strictProxy === true,
  };
}
