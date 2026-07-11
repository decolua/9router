import { Readable } from "stream";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { dbg } from "./debugLog.js";
import {
  createProxyDispatcher,
  createSocksConnector,
  disposeProxyDispatcher as disposeDispatcher,
  isSocksProxyUrl,
  normalizeProxyUrl,
} from "../../src/lib/network/proxyDispatcher.js";

const originalFetch = globalThis.fetch;
const proxyDispatchers = new Map();
// ─── TLS fingerprinting via got-scraping (browser-like JA3) ───────────────
// Used for api.anthropic.com to bypass Cloudflare TLS fingerprint blocks.
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

/** Reset cached got-scraping reference (test helper). */
export function __resetGotScrapingCache() {
  _gotScraping = null;
  _gotScrapingChecked = false;
  _gotScrapingLoggedHosts.clear();
}

async function gotScrapingFetch(url, options) {
  const gs = await getGotScraping();
  if (!gs) return null;

  const method = (options.method || "GET").toUpperCase();
  const headersInit = options.headers || {};
  const headers = headersInit instanceof Headers
    ? Object.fromEntries(headersInit.entries())
    : { ...headersInit };

  // Non-streaming: use the promise API so callers get a single response object.
  const response = await gs({
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

  const resHeaders = new Headers();
  for (const [k, v] of Object.entries(response.headers || {})) {
    if (Array.isArray(v)) v.forEach((x) => resHeaders.append(k, String(x)));
    else if (v != null) resHeaders.set(k, String(v));
  }
  const status = response.statusCode;
  const ok = status >= HTTP_SUCCESS_MIN && status < HTTP_SUCCESS_MAX;
  const rawBody = response.rawBody ?? Buffer.from(response.body || "");
  return {
    ok,
    status,
    statusText: response.statusMessage || "",
    headers: resHeaders,
    body: null,
    text: async () => rawBody.toString("utf8"),
    json: async () => JSON.parse(rawBody.toString("utf8")),
  };
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

function shouldUseGotScraping(targetUrl, options) {
  try {
    const host = new URL(targetUrl).hostname;
    if (host !== "api.anthropic.com") return false;
  } catch {
    return false;
  }
  // Streaming requests need readable body; non-streaming only.
  const accept = options?.headers?.["Accept"] || options?.headers?.["accept"] || "";
  return !String(accept).includes("text/event-stream");
}

// DNS cache — use Map to avoid prototype pollution via malformed hostnames
const DNS_CACHE = new Map();
const MITM_BYPASS_HOSTS = [
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "codewhisperer.us-east-1.amazonaws.com",
  "api2.cursor.sh",
];
const GOOGLE_DNS_SERVERS = ["8.8.8.8", "8.8.4.4"];
const HTTPS_PORT = 443;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 300;

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Resolve real IP using Google DNS (bypass system DNS)
 */
async function resolveRealIP(hostname) {
  const cached = DNS_CACHE.get(hostname);
  if (cached && Date.now() < cached.expiry) return cached.ip;

  try {
    const dns = await import("dns");
    const { promisify } = await import("util");
    const resolver = new dns.Resolver();
    resolver.setServers(GOOGLE_DNS_SERVERS);
    const resolve4 = promisify(resolver.resolve4.bind(resolver));
    const addresses = await resolve4(hostname);
    DNS_CACHE.set(hostname, { ip: addresses[0], expiry: Date.now() + MEMORY_CONFIG.dnsCacheTtlMs });
    return addresses[0];
  } catch (error) {
    console.warn(`[ProxyFetch] DNS resolve failed for ${hostname}:`, error.message);
    return null;
  }
}

/**
 * Check if request should bypass MITM DNS redirect
 */
function shouldBypassMitmDns(url) {
  try {
    const hostname = new URL(url).hostname;
    return MITM_BYPASS_HOSTS.some(host => hostname.includes(host));
  } catch { return false; }
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
 * Caller aborts/timeouts are not proxy transport failures.
 * Prefer signal.aborted because AbortController.abort(reason) may surface
 * custom Error objects rather than AbortError/TimeoutError names.
 */
function isCallerAbort(error, signal) {
  if (signal?.aborted === true) return true;
  const name = error?.name;
  return name === "AbortError" || name === "TimeoutError";
}

function rethrowStrictProxyFailure(proxyError) {
  throw new Error(
    `[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`,
    { cause: proxyError },
  );
}

function handleProxyRequestError(proxyError, options, proxyOptions, fallbackLabel) {
  if (isCallerAbort(proxyError, options?.signal)) {
    throw proxyError;
  }

  if (proxyOptions?.strictProxy === true) {
    rethrowStrictProxyFailure(proxyError);
  }

  console.warn(`[ProxyFetch] Proxy failed, falling back to ${fallbackLabel}: ${proxyError.message}`);
  return null;
}

async function getDispatcher(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  if (!proxyDispatchers.has(normalized)) {
    // Evict oldest entry if max size reached
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      const oldestKey = proxyDispatchers.keys().next().value;
      const oldest = proxyDispatchers.get(oldestKey);
      proxyDispatchers.delete(oldestKey);
      disposeDispatcher(oldest);
    }

    proxyDispatchers.set(normalized, await createProxyDispatcher(normalized));
  }

  return proxyDispatchers.get(normalized);
}

/** Reset cached proxy dispatchers (test helper). */
export function __resetProxyDispatchers() {
  for (const dispatcher of proxyDispatchers.values()) {
    disposeDispatcher(dispatcher);
  }
  proxyDispatchers.clear();
}

/** Exported for connector-level unit tests. */
export { createSocksConnector };

/**
 * Create HTTPS request with manual socket connection (bypass DNS)
 */
async function createBypassRequest(parsedUrl, realIP, options) {
  const httpsModule = await import("https");
  const netModule = await import("net");
  // CJS modules expose exports via .default in ESM dynamic import context
  const https = httpsModule.default ?? httpsModule;
  const net = netModule.default ?? netModule;

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    socket.connect(HTTPS_PORT, realIP, () => {
      const reqOptions = {
        socket,
        // SNI + cert hostname are validated against the hostname the caller
        // asked for, not the IP we connected to. This keeps the DNS-bypass
        // (avoiding /etc/hosts MITM) while still rejecting on-path attackers
        // that present a different cert. The MITM_BYPASS_HOSTS targets are
        // all public-CA-issued (Google / GitHub / AWS / Cursor) so default
        // verification works without any extra trust store.
        servername: parsedUrl.hostname,
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

  // MITM DNS bypass: for known MITM-intercepted hosts, resolve real IP to avoid DNS spoof
  if (shouldBypassMitmDns(targetUrl)) {
    if (proxyUrl) {
      // Proxy resolves DNS externally (not affected by /etc/hosts) — use proxy directly
      try {
        const dispatcher = await getDispatcher(proxyUrl);
        return await originalFetch(url, { ...options, dispatcher });
      } catch (proxyError) {
        handleProxyRequestError(proxyError, options, proxyOptions, "direct bypass");
      }
    }
    // No proxy — manually resolve real IP to bypass DNS spoof
    try {
      const parsedUrl = new URL(targetUrl);
      const realIP = await resolveRealIP(parsedUrl.hostname);
      if (realIP) return await createBypassRequest(parsedUrl, realIP, options);
    } catch (error) {
      console.warn(`[ProxyFetch] MITM bypass failed: ${error.message}`);
    }
  }

  if (proxyUrl) {
    try {
      const dispatcher = await getDispatcher(proxyUrl);
      return await originalFetch(url, { ...options, dispatcher });
    } catch (proxyError) {
      // Caller abort/timeout must propagate. Only genuine proxy transport
      // failures may fall back to direct (unless strictProxy=true).
      handleProxyRequestError(proxyError, options, proxyOptions, "direct");
      return originalFetch(url, options);
    }
  }

  // got-scraping for api.anthropic.com non-streaming (Cloudflare JA3 bypass)
  if (shouldUseGotScraping(targetUrl, options)) {
    const res = await tryGotScrapingFetch(targetUrl, options);
    if (res) return res;
    // fall through to native fetch on failure
  }

  return originalFetch(url, options);
}

/**
 * Patched global fetch with env-proxy support and MITM DNS bypass
 */
async function patchedFetch(url, options = {}) {
  return proxyAwareFetch(url, options, null);
}

// Idempotency guard — only patch once to avoid wrapping multiple times
if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;
