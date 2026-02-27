import tlsClient from "./tlsClient.js";

const isCloud = typeof caches !== "undefined" && typeof caches === "object";

const originalFetch = globalThis.fetch;

/**
 * Check if URL should bypass proxy (NO_PROXY)
 */
function shouldBypassProxy(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (!noProxy) return false;

  const hostname = new URL(targetUrl).hostname.toLowerCase();
  const patterns = noProxy.split(",").map(p => p.trim().toLowerCase());

  return patterns.some(pattern => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Patched fetch with TLS fingerprint spoofing (Chrome 124 via wreq-js).
 *
 * wreq-js natively handles both TLS fingerprinting AND proxy (HTTP/HTTPS/SOCKS).
 * Proxy is configured at session level via env vars (HTTPS_PROXY, HTTP_PROXY, ALL_PROXY).
 *
 * If NO_PROXY matches the target URL, bypasses the TLS client and uses native fetch.
 * If TLS client fails, falls back to native fetch.
 */
async function patchedFetch(url, options = {}) {
  const targetUrl = typeof url === "string" ? url : url.toString();

  // Bypass TLS client for NO_PROXY targets
  if (shouldBypassProxy(targetUrl)) {
    return originalFetch(url, options);
  }

  // Use TLS client (handles both TLS fingerprint + proxy)
  try {
    return await tlsClient.fetch(targetUrl, options);
  } catch (tlsError) {
    console.warn(`[ProxyFetch] TLS client failed, falling back to native fetch: ${tlsError.message}`);
    return originalFetch(url, options);
  }
}

if (!isCloud) {
  globalThis.fetch = patchedFetch;
}

export default isCloud ? originalFetch : patchedFetch;

