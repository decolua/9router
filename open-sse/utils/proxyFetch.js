const isCloud = typeof caches !== "undefined" && typeof caches === "object";

const originalFetch = globalThis.fetch;
let proxyDispatcher = null;
let proxyDispatcherUrl = null;

// Constants
const DNS_CACHE = {};
const MITM_BYPASS_HOSTS = ["cloudcode-pa.googleapis.com", "daily-cloudcode-pa.googleapis.com", "googleapis.com"];
const MITM_BYPASS_HEADER = "x-request-source";
const MITM_BYPASS_VALUE = "local";
const GOOGLE_DNS_SERVERS = ["8.8.8.8", "8.8.4.4"];
const HTTPS_PORT = 443;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 300;

/**
 * Resolve real IP using Google DNS (bypass system DNS)
 */
async function resolveRealIP(hostname) {
  if (DNS_CACHE[hostname]) return DNS_CACHE[hostname];
  
  try {
    const dns = await import("dns");
    const { promisify } = await import("util");
    const resolver = new dns.Resolver();
    resolver.setServers(GOOGLE_DNS_SERVERS);
    const resolve4 = promisify(resolver.resolve4.bind(resolver));
    const addresses = await resolve4(hostname);
    DNS_CACHE[hostname] = addresses[0];
    return addresses[0];
  } catch (error) {
    console.warn(`[ProxyFetch] DNS resolve failed for ${hostname}:`, error.message);
    return null;
  }
}

/**
 * Check if request should bypass MITM DNS redirect
 */
function shouldBypassMitmDns(url, options) {
  if (!options?.headers) return false;
  
  const headers = options.headers;
  const hasLocalMarker = headers[MITM_BYPASS_HEADER] === MITM_BYPASS_VALUE || 
                         headers[MITM_BYPASS_HEADER.charAt(0).toUpperCase() + MITM_BYPASS_HEADER.slice(1)] === MITM_BYPASS_VALUE;
  
  if (!hasLocalMarker) {
    // Debug: log when bypass is not triggered
    const hostname = new URL(url).hostname;
    if (MITM_BYPASS_HOSTS.some(host => hostname.includes(host))) {
      console.warn(`[ProxyFetch] MITM bypass NOT triggered for ${hostname} - missing header`);
    }
    return false;
  }
  
  const hostname = new URL(url).hostname;
  return MITM_BYPASS_HOSTS.some(host => hostname.includes(host));
}

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
 * Create HTTPS request with manual socket connection (bypass DNS)
 */
async function createBypassRequest(parsedUrl, realIP, options) {
  const https = await import("https");
  const net = await import("net");
  const { Readable } = require("stream");
  
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    
    socket.connect(HTTPS_PORT, realIP, () => {
      const reqOptions = {
        socket,
        servername: parsedUrl.hostname,
        rejectUnauthorized: false,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "POST",
        headers: {
          ...options.headers,
          Host: parsedUrl.hostname,
        },
      };
      
      const req = https.request(reqOptions, (res) => {
        const response = {
          ok: res.statusCode >= HTTP_SUCCESS_MIN && res.statusCode < HTTP_SUCCESS_MAX,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: new Map(Object.entries(res.headers)),
          body: Readable.toWeb(res),
          text: async () => {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            return Buffer.concat(chunks).toString();
          },
          json: async () => JSON.parse(await response.text()),
        };
        resolve(response);
      });
      
      req.on("error", reject);
      if (options.body) {
        req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
    
    socket.on("error", reject);
  });
}

/**
 * Patched fetch with proxy support and MITM DNS bypass
 */
async function patchedFetch(url, options = {}) {
  const targetUrl = typeof url === "string" ? url : url.toString();
  
  // MITM DNS bypass: resolve real IP for googleapis.com when x-request-source: local
  if (shouldBypassMitmDns(targetUrl, options)) {
    try {
      const parsedUrl = new URL(targetUrl);
      const realIP = await resolveRealIP(parsedUrl.hostname);
      if (realIP) return await createBypassRequest(parsedUrl, realIP, options);
    } catch (error) {
      console.warn(`[ProxyFetch] MITM bypass failed: ${error.message}`);
    }
  }
  
  // Normal proxy handling
  const proxyUrl = normalizeProxyUrl(getProxyUrl(targetUrl));
  if (proxyUrl) {
    try {
      const dispatcher = await getDispatcher(proxyUrl);
      return await originalFetch(url, { ...options, dispatcher });
    } catch (proxyError) {
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
