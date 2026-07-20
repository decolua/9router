const RELAY_POOL_TYPES = new Set(["vercel", "cloudflare", "deno"]);

function splitProxyUrls(value) {
  return String(value || "")
    .split(/[\s,;]+(?=(?:https?:\/\/|socks[45]:\/\/))/i)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getBrowserProxyPools(payload = {}) {
  const pools = payload.proxyPools
    || payload.pools
    || payload.data?.proxyPools
    || payload.data?.pools
    || [];

  return pools
    .filter((pool) => pool?.isActive !== false && splitProxyUrls(pool?.proxyUrl).length > 0)
    .map((pool) => ({
      ...pool,
      browserCompatible: !RELAY_POOL_TYPES.has(pool?.type),
    }));
}

export function formatBrowserProxyPoolOption(pool) {
  const label = pool?.name || pool?.proxyUrl || pool?.id || "Proxy pool";
  if (pool?.browserCompatible === false) return `${label} (relay - unavailable for browser)`;
  const count = splitProxyUrls(pool?.proxyUrl).length;
  return `${label} (${count} ${count === 1 ? "proxy" : "proxies"})`;
}
