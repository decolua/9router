const isCloud = typeof caches !== "undefined" && typeof caches === "object";

const originalFetch = globalThis.fetch;
let proxyDispatcher = null;
let proxyDispatcherUrl = null;

/**
 * Get proxy URL from environment
 */
function getProxyUrl(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  
  if (noProxy) {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    const patterns = noProxy.split(",").map(p => p.trim().toLowerCase());
    
    const shouldBypass = patterns.some(pattern => {
      if (pattern === "*") return true;
      if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
      return hostname === pattern || hostname.endsWith(`.${pattern}`);
    });
    
    if (shouldBypass) return null;
  }

  const protocol = new URL(targetUrl).protocol;
  
  if (protocol === "https:") {
    return process.env.HTTPS_PROXY || process.env.https_proxy || 
           process.env.ALL_PROXY || process.env.all_proxy;
  }
  
  return process.env.HTTP_PROXY || process.env.http_proxy ||
         process.env.ALL_PROXY || process.env.all_proxy;
}

/**
 * Normalize proxy URL (allow host:port)
 */
function normalizeProxyUrl(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    // eslint-disable-next-line no-new
    new URL(proxyUrl);
    return proxyUrl;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${proxyUrl}`;
  }
}

/**
 * Create proxy dispatcher lazily (undici-compatible)
 * Closes old dispatcher when proxy URL changes to prevent connection pool leak
 */
async function getDispatcher(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  if (!proxyDispatcher || proxyDispatcherUrl !== normalized) {
    try { proxyDispatcher?.close?.(); } catch { /* ignore */ }
    const { ProxyAgent } = await import("undici");
    proxyDispatcher = new ProxyAgent({ uri: normalized });
    proxyDispatcherUrl = normalized;
  }

  return proxyDispatcher;
}

/**
 * Patched fetch with proxy support and fallback to direct connection
 */
async function patchedFetch(url, options = {}) {
  const targetUrl = typeof url === "string" ? url : url.toString();
  const proxyUrl = normalizeProxyUrl(getProxyUrl(targetUrl));
  
  if (proxyUrl) {
    try {
      const dispatcher = await getDispatcher(proxyUrl);
      return await originalFetch(url, { ...options, dispatcher });
    } catch (proxyError) {
      // Fallback to direct connection if proxy fails
      console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`);
      return originalFetch(url, options);
    }
  }
  
  return originalFetch(url, options);
}

// Idempotency guard — only patch once to avoid wrapping multiple times
if (!isCloud && globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default isCloud ? originalFetch : patchedFetch;
