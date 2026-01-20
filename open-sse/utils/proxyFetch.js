
const isCloud = typeof caches !== "undefined" && typeof caches === "object";

const originalFetch = globalThis.fetch;
let proxyAgent = null;
let socksAgent = null;

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
 * Create proxy agent lazily
 */
async function getAgent(proxyUrl) {
  const proxyProtocol = new URL(proxyUrl).protocol;
  
  if (proxyProtocol === "socks:" || proxyProtocol === "socks5:" || proxyProtocol === "socks4:") {
    if (!socksAgent) {
      const { SocksProxyAgent } = await import("socks-proxy-agent");
      socksAgent = new SocksProxyAgent(proxyUrl);
    }
    return socksAgent;
  }
  
  if (!proxyAgent) {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    proxyAgent = new HttpsProxyAgent(proxyUrl);
  }
  return proxyAgent;
}

/**
 * Patched fetch with proxy support and fallback to direct connection
 */
async function patchedFetch(url, options = {}) {
  const targetUrl = typeof url === "string" ? url : url.toString();
  const proxyUrl = getProxyUrl(targetUrl);
  
  if (proxyUrl) {
    try {
      const agent = await getAgent(proxyUrl);
      return await originalFetch(url, { ...options, dispatcher: agent });
    } catch (proxyError) {
      // Fallback to direct connection if proxy fails
      console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`);
      return originalFetch(url, options);
    }
  }
  
  return originalFetch(url, options);
}

if (!isCloud) {
  globalThis.fetch = patchedFetch;
}

export default isCloud ? originalFetch : patchedFetch;
