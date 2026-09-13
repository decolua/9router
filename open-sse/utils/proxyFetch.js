import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { dbg } from "./debugLog.js";

const originalFetch = globalThis.fetch;
const proxyDispatchers = new Map();

// ─── TLS fingerprinting via got-scraping (browser-like JA3) ───────────────
// Disabled: not in use. Kept commented for future re-enable.
// Restore the original block to re-enable per-host JA3 spoofing.
/*
let _gotScraping = null;
let _gotScrapingChecked = false;
const _gotScrapingLoggedHosts = new Set();

async function getGotScraping() {
  if (_gotScrapingChecked) return _gotScraping;
  _gotScrapingChecked = true;
  try {
    const mod = await import("got-scraping");
    _gotScraping = typeof mod.gotScraping === "function" ? mod.gotScraping : null;
    if (_gotScraping) dbg("TLS", "got-scraping loaded (browser-like JA3 enabled)");
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping unavailable, falling back to native fetch: ${e.message}`);
    _gotScraping = null;
  }
  return _gotScraping;
}

async function gotScrapingFetch(url, options) {
  const gs = await getGotScraping();
  if (!gs) return null;

  const method = (options.method || "GET").toUpperCase();
  const headersInit = options.headers || {};
  const headers = headersInit instanceof Headers
    ? Object.fromEntries(headersInit.entries())
    : { ...headersInit };

  return new Promise((resolve, reject) => {
    let settled = false;
    const stream = gs.stream({
      url,
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : options.body,
      throwHttpErrors: false,
      retry: { limit: 0 },
      timeout: { request: undefined },
      followRedirect: false,
      decompress: true,
    });

    if (options.signal) {
      const onAbort = () => { try { stream.destroy(new Error("aborted")); } catch { } };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    stream.once("response", (res) => {
      if (settled) return;
      settled = true;
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers || {})) {
        if (Array.isArray(v)) v.forEach((x) => resHeaders.append(k, String(x)));
        else if (v != null) resHeaders.set(k, String(v));
      }
      const body = Readable.toWeb(stream);
      resolve(new Response(body, { status: res.statusCode, statusText: res.statusMessage || "", headers: resHeaders }));
    });

    stream.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function tryGotScrapingFetch(url, options) {
  try {
    const res = await gotScrapingFetch(url, options);
    if (res) {
      try {
        const host = new URL(typeof url === "string" ? url : url.toString()).hostname;
        if (!_gotScrapingLoggedHosts.has(host)) {
          _gotScrapingLoggedHosts.add(host);
          dbg("TLS", `using got-scraping for ${host}`);
        }
      } catch { }
    }
    return res;
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping request failed, fallback to native fetch: ${e.message}`);
    return null;
  }
}
*/
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try { hostname = new URL(targetUrl).hostname.toLowerCase(); } catch { return false; }
  const patterns = noProxy.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Get proxy URL from environment
 */
function getEnvProxyUrl(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  let protocol;
  try { protocol = new URL(targetUrl).protocol; } catch { return null; }

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
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {

    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${normalizedInput}`;
  }
}

function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

/**
 * Create proxy dispatcher lazily (undici-compatible)
 */
async function getDispatcher(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  if (!proxyDispatchers.has(normalized)) {
    // Evict oldest entry if max size reached
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      proxyDispatchers.delete(proxyDispatchers.keys().next().value);
    }
    const { ProxyAgent } = await import("undici");
    proxyDispatchers.set(normalized, new ProxyAgent({ uri: normalized }));
  }

  return proxyDispatchers.get(normalized);
}

export async function proxyAwareFetch(url, options = {}, proxyOptions = null) {
  const targetUrl = typeof url === "string" ? url : url.toString();

  // Vercel relay: forward request via relay headers
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    const relayHeaders = {
      ...options.headers,
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    return originalFetch(vercelRelayUrl, { ...options, headers: relayHeaders });
  }

  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;

  if (proxyUrl) {
    try {
      const dispatcher = await getDispatcher(proxyUrl);
      return await originalFetch(url, { ...options, dispatcher });
    } catch (proxyError) {
      // If strictProxy is enabled, fail hard instead of falling back to direct
      if (proxyOptions?.strictProxy === true) {
        throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
      }
      console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`);
      return originalFetch(url, options);
    }
  }

  // got-scraping disabled — use native fetch directly
  // (Re-enable per-host by wrapping with tryGotScrapingFetch when needed)
  return originalFetch(url, options);
}

/**
 * Patched global fetch with env-proxy support
 */
async function patchedFetch(url, options = {}) {
  return proxyAwareFetch(url, options, null);
}

// Idempotency guard — only patch once to avoid wrapping multiple times
if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;
