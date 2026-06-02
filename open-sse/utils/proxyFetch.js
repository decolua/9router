import { Readable } from "stream";
import https from "https";
import dns from "dns";
import {
  CONNECTION_PROXY_HEADERS_TIMEOUT_MS,
  MEMORY_CONFIG,
} from "../config/runtimeConfig.js";
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

// DNS cache — use Map to avoid prototype pollution via malformed hostnames
const DNS_CACHE = new Map();

const bypassKeepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 30000,
  lookup: (hostname, options, callback) => {
    resolveRealIP(hostname)
      .then((ip) => {
        if (ip) {
          callback(null, ip, 4);
        } else {
          dns.lookup(hostname, options, callback);
        }
      })
      .catch((err) => {
        callback(err);
      });
  },
});
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
    DNS_CACHE.set(hostname, {
      ip: addresses[0],
      expiry: Date.now() + MEMORY_CONFIG.dnsCacheTtlMs,
    });
    return addresses[0];
  } catch (error) {
    console.warn(
      `[ProxyFetch] DNS resolve failed for ${hostname}:`,
      error.message,
    );
    return null;
  }
}

/**
 * Check if request should bypass MITM DNS redirect
 */
function shouldBypassMitmDns(url) {
  try {
    const hostname = new URL(url).hostname;
    return MITM_BYPASS_HOSTS.some((host) => hostname.includes(host));
  } catch {
    return false;
  }
}

function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const patterns = noProxy
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith("."))
      return hostname.endsWith(pattern) || hostname === pattern.slice(1);
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
  try {
    protocol = new URL(targetUrl).protocol;
  } catch {
    return null;
  }

  if (protocol === "https:") {
    return (
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy
    );
  }

  return (
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  );
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
  const enabled =
    proxyOptions?.enabled === true ||
    proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(
    proxyOptions?.url ?? proxyOptions?.connectionProxyUrl,
  );
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(
    proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy,
  );
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

function maskProxyUrl(proxyUrl) {
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<invalid-proxy-url>";
  }
}

function sanitizeProxyError(error) {
  const name = normalizeString(error?.name) || "Error";
  const code = normalizeString(error?.code);
  const message = normalizeString(error?.message)
    .replace(/\b(?:https?|socks5?|socks4):\/\/[^\s]+/gi, "<redacted-url>")
    .replace(
      /(proxy-authorization|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=<redacted>",
    )
    .slice(0, 240);

  return `${name}${code ? `/${code}` : ""}${message ? `: ${message}` : ""}`;
}

function resolveProxyHeadersTimeoutMs(proxyOptions) {
  const configured = Number(
    proxyOptions?.connectionProxyHeadersTimeoutMs ??
      proxyOptions?.headersTimeoutMs,
  );
  if (Number.isFinite(configured) && configured > 0) return configured;
  return CONNECTION_PROXY_HEADERS_TIMEOUT_MS;
}

async function fetchViaProxyWithHeadersTimeout(
  url,
  options,
  dispatcher,
  timing,
  proxyOptions,
) {
  const timeoutMs = resolveProxyHeadersTimeoutMs(proxyOptions);
  timing.proxyHeadersTimeoutMs = timeoutMs;

  const controller = new AbortController();
  const upstreamSignal = options.signal;
  let upstreamAbortListener = null;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason);
    else {
      upstreamAbortListener = () => controller.abort(upstreamSignal.reason);
      upstreamSignal.addEventListener("abort", upstreamAbortListener, {
        once: true,
      });
    }
  }

  const timer = setTimeout(() => {
    timing.proxyHeadersTimedOut = true;
    controller.abort(
      new DOMException("Connection proxy headers timed out", "TimeoutError"),
    );
  }, timeoutMs);

  try {
    return await originalFetch(url, {
      ...options,
      dispatcher,
      signal: controller.signal,
    });
  } catch (error) {
    if (timing.proxyHeadersTimedOut) {
      const timeoutError = new Error(
        `Connection proxy headers timed out after ${timeoutMs}ms`,
      );
      timeoutError.name = "TimeoutError";
      timeoutError.status = 504;
      timeoutError.proxyHeadersTimedOut = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (upstreamSignal && upstreamAbortListener) {
      upstreamSignal.removeEventListener("abort", upstreamAbortListener);
    }
  }
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
      const oldestKey = proxyDispatchers.keys().next().value;
      const oldestDispatcher = proxyDispatchers.get(oldestKey);
      if (oldestDispatcher) {
        try {
          oldestDispatcher.destroy(); // Gracefully destroy the dispatcher and close all active sockets
        } catch (e) {
          console.warn(
            `[ProxyFetch] Failed to destroy evicted dispatcher:`,
            e.message,
          );
        }
      }
      proxyDispatchers.delete(oldestKey);
    }
    const { ProxyAgent } = await import("undici");
    proxyDispatchers.set(
      normalized,
      new ProxyAgent({
        uri: normalized,
        pipelining: 1,
        maxRedirections: 5,
        clientOptions: {
          connect: {
            keepAlive: true,
            keepAliveInitialDelay: 1000,
            timeout: 30000,
          },
          pipelining: 1,
          keepAliveTimeout: 60000,
          keepAliveMaxTimeout: 300000,
        },
      }),
    );
  }

  return proxyDispatchers.get(normalized);
}

/**
 * Create HTTPS request with manual socket connection (bypass DNS)
 */
async function createBypassRequest(parsedUrl, realIP, options, timing = null) {
  const httpsModule = await import("https");
  const https = httpsModule.default ?? httpsModule;

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: HTTPS_PORT,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "POST",
      headers: {
        ...options.headers,
        Host: parsedUrl.hostname,
      },
      agent: bypassKeepAliveAgent,
      servername: parsedUrl.hostname,
      signal: options.signal,
    };

    const req = https.request(reqOptions, (res) => {
      if (timing && !timing.headersAt) timing.headersAt = Date.now();
      const response = {
        ok:
          res.statusCode >= HTTP_SUCCESS_MIN &&
          res.statusCode < HTTP_SUCCESS_MAX,
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
      if (timing) response.__timing = timing;
      resolve(response);
    });

    req.on("error", reject);

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy();
        reject(new DOMException("The user aborted a request.", "AbortError"));
      } else {
        options.signal.addEventListener("abort", () => {
          req.destroy();
          reject(new DOMException("The user aborted a request.", "AbortError"));
        });
      }
    }

    if (options.body) {
      req.write(
        typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body),
      );
    }
    req.end();
  });
}

export async function proxyAwareFetch(url, options = {}, proxyOptions = null) {
  const targetUrl = typeof url === "string" ? url : url.toString();
  const timing = {
    startedAt: Date.now(),
    mode: "direct",
  };

  // Vercel relay: forward request via relay headers
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) {
    timing.mode = "vercel-relay";
    timing.relayStartAt = Date.now();
    const parsed = new URL(targetUrl);
    const relayHeaders = {
      ...options.headers,
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    const response = await originalFetch(vercelRelayUrl, {
      ...options,
      headers: relayHeaders,
    });
    timing.headersAt = Date.now();
    response.__timing = timing;
    return response;
  }

  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl
    ? null
    : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;
  if (proxyUrl) {
    timing.proxySource = connectionProxyUrl ? "connection" : "env";
    timing.proxyUrl = maskProxyUrl(proxyUrl);
    timing.strictProxy = proxyOptions?.strictProxy === true;
  }

  // MITM DNS bypass: for known MITM-intercepted hosts, resolve real IP to avoid DNS spoof
  if (shouldBypassMitmDns(targetUrl)) {
    if (proxyUrl) {
      timing.mode = "proxy-mitm-bypass";
      timing.proxyStartAt = Date.now();
      // Proxy resolves DNS externally (not affected by /etc/hosts) — use proxy directly
      try {
        const dispatcher = await getDispatcher(proxyUrl);
        timing.dispatcherReadyAt = Date.now();
        const response = await fetchViaProxyWithHeadersTimeout(
          url,
          options,
          dispatcher,
          timing,
          proxyOptions,
        );
        timing.headersAt = Date.now();
        response.__timing = timing;
        return response;
      } catch (proxyError) {
        const sanitizedProxyError = sanitizeProxyError(proxyError);
        timing.proxyError = sanitizedProxyError;
        if (proxyError.proxyHeadersTimedOut) throw proxyError;
        if (proxyOptions?.strictProxy === true) {
          throw new Error(
            `[ProxyFetch] Proxy required but failed (strictProxy=true): ${sanitizedProxyError}`,
          );
        }
        console.warn(
          `[ProxyFetch] Proxy failed, falling back to direct bypass: ${sanitizedProxyError}`,
        );
      }
    }
    // No proxy — manually resolve real IP to bypass DNS spoof
    try {
      const parsedUrl = new URL(targetUrl);
      timing.mode = "dns-bypass";
      timing.dnsStartAt = Date.now();
      const realIP = await resolveRealIP(parsedUrl.hostname);
      timing.dnsResolvedAt = Date.now();
      if (realIP)
        return await createBypassRequest(parsedUrl, realIP, options, timing);
    } catch (error) {
      console.warn(`[ProxyFetch] MITM bypass failed: ${error.message}`);
    }
  }

  if (proxyUrl) {
    try {
      timing.mode = "proxy";
      timing.proxyStartAt = Date.now();
      const dispatcher = await getDispatcher(proxyUrl);
      timing.dispatcherReadyAt = Date.now();
      const response = await fetchViaProxyWithHeadersTimeout(
        url,
        options,
        dispatcher,
        timing,
        proxyOptions,
      );
      timing.headersAt = Date.now();
      response.__timing = timing;
      return response;
    } catch (proxyError) {
      const sanitizedProxyError = sanitizeProxyError(proxyError);
      timing.proxyError = sanitizedProxyError;
      if (proxyError.proxyHeadersTimedOut) throw proxyError;
      // If strictProxy is enabled, fail hard instead of falling back to direct
      if (proxyOptions?.strictProxy === true) {
        throw new Error(
          `[ProxyFetch] Proxy required but failed (strictProxy=true): ${sanitizedProxyError}`,
        );
      }
      console.warn(
        `[ProxyFetch] Proxy failed, falling back to direct: ${sanitizedProxyError}`,
      );
      timing.mode = "direct-fallback";
      timing.directFallbackStartAt = Date.now();
      try {
        const response = await originalFetch(url, options);
        timing.headersAt = Date.now();
        response.__timing = timing;
        return response;
      } catch (fallbackError) {
        const sanitizedFallbackError = sanitizeProxyError(fallbackError);
        console.error(
          `[ProxyFetch] Direct fallback also failed: ${sanitizedFallbackError}`,
        );
        const combinedError = new Error(
          `Proxy failed (${sanitizedProxyError}) and direct fallback also failed (${sanitizedFallbackError})`,
        );
        combinedError.name = fallbackError.name;
        combinedError.status = fallbackError.status || 502;
        throw combinedError;
      }
    }
  }

  // got-scraping disabled — use native fetch directly
  // (Re-enable per-host by wrapping with tryGotScrapingFetch when needed)
  const response = await originalFetch(url, options);
  timing.headersAt = Date.now();
  response.__timing = timing;
  return response;
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
