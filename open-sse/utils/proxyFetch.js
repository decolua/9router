import { Readable } from "stream";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { dbg } from "./debugLog.js";

// ─── Global fetch patch idempotency (QA-9ROUTER-18) ─────────────────────────
// This module patches globalThis.fetch. Re-evaluating the module — vitest
// vi.resetModules(), dev/HMR, next worker threads — used to install a SECOND
// wrapper whose "original fetch" was the FIRST wrapper, so every wrapper layer
// re-attempted the (dead) proxy: ONE fetch produced 2^N-1 proxy attempts and
// warnings after N evaluations.
//
// The wrapper is therefore tagged with a process-wide symbol and the real
// inner fetch is resolved at CALL time by unwrapping every tagged wrapper —
// never captured at module-evaluation time.
const PATCH_MARK = Symbol.for("9router.proxyFetch.patched");
const INNER_FETCH = Symbol.for("9router.proxyFetch.innerFetch");
// Last-resort fetch captured at module evaluation. Only consulted when a tagged
// wrapper cannot be unwrapped (foreign/older patch without an inner fetch).
const fallbackFetch = globalThis.fetch;

const proxyDispatchers = new Map();

function isPatchedFetch(fn) {
  return typeof fn === "function" && fn[PATCH_MARK] === true;
}

/**
 * Unwrap a chain of tagged wrappers down to the first untagged function.
 * Returns null when the chain is cyclic or a layer has no usable inner fetch.
 */
function unwrapFetch(fn) {
  let current = fn;
  const seen = new Set();
  while (isPatchedFetch(current)) {
    if (seen.has(current)) return null;
    seen.add(current);
    const inner = current[INNER_FETCH];
    if (typeof inner !== "function") return null;
    current = inner;
  }
  return typeof current === "function" ? current : null;
}

/**
 * Resolve the fetch that actually performs the request, AT CALL TIME.
 * An untagged function (native fetch, or a test stub installed via
 * `globalThis.fetch = vi.fn()`) is respected as-is; a tagged wrapper is
 * unwrapped so a stacked chain collapses to the real fetch. Never returns a
 * tagged wrapper, so the wrapper can never recurse into itself.
 */
function resolveInnerFetch() {
  const current = globalThis.fetch;
  if (!isPatchedFetch(current)) return current;

  const unwrapped = unwrapFetch(current);
  if (unwrapped) return unwrapped;

  // Degenerate chain (cyclic, or a foreign wrapper without an inner fetch):
  // prefer the evaluation-time fetch when it is usable, otherwise fail loud
  // instead of looping back into this wrapper forever.
  const fallback = unwrapFetch(fallbackFetch);
  if (fallback) return fallback;
  return typeof fallbackFetch === "function" && !isPatchedFetch(fallbackFetch)
    ? fallbackFetch
    : undefined;
}

// ─── Proxy-failure warning dedupe (QA-9ROUTER-18) ───────────────────────────
// Keyed by "<proxyUrl>|<message>" and stored on a process-wide symbol so the
// dedupe SURVIVES module re-evaluation: one warning per distinct failure per
// process instead of one per evaluation (the flood reached 262,143 lines).
// Bounded so a pathological error message cannot grow the set without limit.
const PROXY_WARN_SEEN = Symbol.for("9router.proxyFetch.warnedProxyFailures");
const PROXY_WARN_MAX_KEYS = 500;
if (!globalThis[PROXY_WARN_SEEN]) globalThis[PROXY_WARN_SEEN] = new Set();
const warnedProxyFailures = globalThis[PROXY_WARN_SEEN];

function warnProxyFailureOnce(fallbackLabel, proxyUrl, message) {
  const key = `${proxyUrl}|${message}`;
  if (warnedProxyFailures.has(key)) {
    dbg("PROXY", `proxy failed, falling back to ${fallbackLabel} (already warned): ${message}`);
    return;
  }
  if (warnedProxyFailures.size < PROXY_WARN_MAX_KEYS) warnedProxyFailures.add(key);
  console.warn(`[ProxyFetch] Proxy failed, falling back to ${fallbackLabel}: ${message}`);
}

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
const TLS_CERT_ERRORS = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function isTlsCertError(err) {
  const code = err?.cause?.code || err?.code;
  return TLS_CERT_ERRORS.has(code);
}
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
async function getDispatcher(proxyUrl, insecure = false) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized && !insecure) return null;

  const key = `${normalized || "direct"}::${insecure ? "insecure" : "secure"}`;
  if (!proxyDispatchers.has(key)) {
    // Evict oldest entry if max size reached
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      proxyDispatchers.delete(proxyDispatchers.keys().next().value);
    }
    const { Agent, ProxyAgent } = await import("undici");
    const connect = insecure ? { rejectUnauthorized: false } : undefined;
    const dispatcher = normalized
      ? new ProxyAgent({ uri: normalized, ...(insecure ? { requestTls: connect } : {}) })
      : new Agent({ connect });
    proxyDispatchers.set(key, dispatcher);
  }

  return proxyDispatchers.get(key);
}

async function fetchWithTlsFallback(url, options, proxyUrl) {
  try {
    // Protocol adapters may need Node's HTTP/1 transport on the direct path.
    // Keep proxy/no-proxy resolution and strict-proxy enforcement here.
    if (!proxyUrl && options.directFetch) return await options.directFetch(url, options);
    const dispatcher = proxyUrl ? await getDispatcher(proxyUrl) : undefined;
    const innerFetch = resolveInnerFetch();
    return await innerFetch(url, dispatcher ? { ...options, dispatcher } : options);
  } catch (err) {
    const isStrictSsl = options.strictTls === true || process.env.STRICT_SSL === "true" || process.env.STRICT_SSL === "1";
    if (!isStrictSsl && isTlsCertError(err)) {
      if (options.body && typeof options.body.getReader === "function" && options.body.locked) {
        throw err;
      }
      // ponytail: in-memory insecure agent fallback for self-signed MITM corporate/antivirus certs
      console.warn(`[ProxyFetch] TLS cert verification failed (${err.cause?.code || err.code}), retrying with insecure TLS: ${url}`);
      const insecureDispatcher = await getDispatcher(proxyUrl, true);
      return await resolveInnerFetch()(url, { ...options, dispatcher: insecureDispatcher });
    }
    throw err;
  }
}

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
  const res = await proxyAwareFetchRaw(url, options, proxyOptions);
  // DF-9ROUTER-42: single seam — every response that leaves the proxy-aware
  // engine (proxy, MITM bypass, vercel relay, direct) is checked for a raw
  // gzip body before it reaches a provider .json()/text() consumer.
  return guardGzipResponse(res);
}

async function proxyAwareFetchRaw(url, options = {}, proxyOptions = null) {
  const targetUrl = typeof url === "string" ? url : url.toString();
  // Resolved per call, never at module-evaluation time: a re-evaluated module
  // must not treat a previous wrapper as the "original" fetch.
  const innerFetch = resolveInnerFetch();

  // Vercel relay: forward request via relay headers
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    const baseHeaders = options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : { ...(options.headers || {}) };
    const relayHeaders = {
      ...baseHeaders,
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    return innerFetch(vercelRelayUrl, { ...options, headers: relayHeaders });
  }

  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;

  // MITM DNS bypass: for known MITM-intercepted hosts, resolve real IP to avoid DNS spoof
  if (shouldBypassMitmDns(targetUrl)) {
    if (proxyUrl) {
      // Proxy resolves DNS externally (not affected by /etc/hosts) — use proxy directly
      try {
        return await fetchWithTlsFallback(url, options, proxyUrl);
      } catch (proxyError) {
        if (proxyOptions?.strictProxy === true) {
          throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
        }
        warnProxyFailureOnce("direct bypass", proxyUrl, proxyError.message);
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
      return await fetchWithTlsFallback(url, options, proxyUrl);
    } catch (proxyError) {
      // If strictProxy is enabled, fail hard instead of falling back to direct
      if (proxyOptions?.strictProxy === true) {
        throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
      }
      warnProxyFailureOnce("direct", proxyUrl, proxyError.message);
      return fetchWithTlsFallback(url, options, null);
    }
  }

  // Strict mode means "never leave over the direct IP". Reaching here with a
  // proxy configured but unresolved is exactly that case — an inactive or
  // empty pool, or every proxy removed — so refuse instead of silently
  // exposing the real address (#4333). The catch blocks above only cover a
  // proxy that was actually tried.
  //
  // Gate on a proxy being *intended*: callers like the Qoder executor set
  // strictProxy to mean "do not replay this request directly if the proxy
  // fails" (a replayed COSY signature returns 403), not "a proxy is required".
  // With nothing configured they must keep working.
  const proxyIntended = proxyOptions?.proxyPoolId
    || proxyOptions?.enabled === true
    || proxyOptions?.connectionProxyEnabled === true
    || !!normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (proxyOptions?.strictProxy === true && proxyIntended) {
    throw new Error("[ProxyFetch] Proxy required but none resolved (strictProxy=true)");
  }

  // got-scraping disabled — use native fetch directly
  // (Re-enable per-host by wrapping with tryGotScrapingFetch when needed)
  return fetchWithTlsFallback(url, options, null);
}

/**
 * Patched global fetch with env-proxy support and MITM DNS bypass
 */
async function patchedFetch(url, options = {}) {
  return proxyAwareFetch(url, options, null);
}

// ─── Transparent gzip guard (DF-9ROUTER-42) ─────────────────────────────────
// With undici 8 inside the Next runtime, provider upstream responses can
// reach consumers with `content-encoding: gzip` still set and a raw gzip
// stream as the body — providerResponse.json() then throws
// `Unexpected token \u001f ... is not valid JSON` (chat 503
// "Invalid JSON response from gemini", images/TTS 502). The same chain
// decompresses transparently with undici 7, in bare node, and in vitest, so
// the guard is installed here at the single boundary every provider call
// crosses: whatever inner fetch ran, a response still carrying an
// uncompressed-able gzip body is delivered decompressed. Scoped strictly to
// gzip with a ReadableStream body — br/deflate and non-stream bodies are
// handed through untouched, and failure to decompress is fail-open (the
// original response is returned rather than masking the real upstream error).
const GZIP_HEADER_RE = /^\s*gzip\s*(?:,|$)/i;
// Max bytes the guard will buffer while inspecting/decompressing a JSON-bound
// response body. Generous for any real JSON payload; keeps a runaway response
// from exhausting memory.
const SNIFF_BUFFER_MAX = 64 * 1024 * 1024;

function shouldGuardGzipResponse(res) {
  try {
    const encoding = res?.headers?.get?.("content-encoding") ?? "";
    // Duck-type the body (getReader) instead of `instanceof ReadableStream`:
    // inside the Next runtime the Response can come from a bundled/aliased
    // undici copy whose ReadableStream is a DIFFERENT realm's constructor,
    // which makes instanceof false and would silently skip the guard.
    const hasStreamBody = !!res?.body && typeof res.body.getReader === "function";
    return GZIP_HEADER_RE.test(encoding) && hasStreamBody;
  } catch {
    return false;
  }
}

function isGzipMagic(chunk) {
  return !!chunk && chunk.length >= 2 && chunk[0] === 0x1f && chunk[1] === 0x8b;
}

/**
 * Concatenate buffered Uint8Array chunks into one Uint8Array — the single
 * Uint8Array constructor is understood identically by every Response
 * implementation in the process (native and bundled), unlike chunk arrays
 * (stringified) or cross-realm streams.
 */
function concatChunks(chunks) {
  if (!chunks.length) return new Uint8Array(0);
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Re-serve a stream body whose first chunk we already consumed, cancelling the
 * upstream reader when the consumer aborts (generator return()) or finishes.
 */
function streamWithFirstChunk(reader, firstChunk) {
  return async function* () {
    try {
      yield firstChunk;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        yield next.value;
      }
    } finally {
      try {
        reader.cancel();
      } catch { /* already closed */ }
    }
  };
}

/**
 * Inspect the first chunk of the RAW body stream and route it:
 * - genuine gzip (0x1f 0x8b magic)  -> gunzip the whole stream, drop the
 *   encoding/content-length headers so consumers see a plain body;
 * - anything else (undici 8 already decompressed the body but left the
 *   `content-encoding` header set, or a non-gzip encoding) -> hand the raw
 *   chunks through untouched, so nothing is ever garbage-in or lost.
 */
async function rebuildGzipResponse(res) {
  const { createGunzip } = await import("node:zlib");
  const { PassThrough, Readable } = await import("node:stream");

  const reader = res.body.getReader();
  let firstChunk;
  const buffered = [];
  try {
    const first = await reader.read();
    if (first.done) {
      // Empty body: nothing to decompress, nothing to lose.
      return new Response(null, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    firstChunk = first.value;
    // Buffer the whole remainder: the Next runtime's response re-wrapping can
    // leave this stream locked to a second consumer, so re-serving a lazy
    // reader-backed stream fails with `ReadableStream is locked`. JSON-bound
    // bodies are bounded, and the guard caps the buffer (SNIFF_BUFFER_MAX)
    // to keep a runaway response from exhausting memory.
    let total = firstChunk.length;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      buffered.push(next.value);
      total += next.value.length;
      if (total > SNIFF_BUFFER_MAX) {
        dbg("PROXY", `gzip guard: body exceeds ${SNIFF_BUFFER_MAX}B, aborting guard (returning original)`);
        try {
          reader.cancel();
        } catch { /* ignore */ }
        return res;
      }
    }
  } catch (e) {
    dbg("PROXY", `gzip guard could not read body, returning original response: ${e.message}`);
    try {
      reader.cancel();
    } catch { /* ignore */ }
    return res;
  } finally {
    try {
      reader.releaseLock();
    } catch { /* ignore */ }
  }

  const all = [firstChunk, ...buffered];

  if (!isGzipMagic(firstChunk)) {
    // Not actually gzip — serve the buffered bytes as-is (headers untouched,
    // so the body/content-length pair stays valid exactly like undici 7 did).
    return new Response(concatChunks(all), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  // Genuine gzip: decompress the whole buffered body.
  let plain;
  try {
    plain = await new Promise((resolve, reject) => {
      const gunzip = createGunzip();
      gunzip.on("data", (c) => parts.push(c));
      const parts = [];
      gunzip.on("end", () => resolve(parts));
      gunzip.on("error", reject);
      for (const chunk of all) gunzip.write(chunk);
      gunzip.end();
    });
  } catch (e) {
    dbg("PROXY", `gzip decompress failed, serving raw body: ${e.message}`);
    // fail-open: serve the raw bytes rather than masking the upstream error
    return new Response(concatChunks(all), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }
  const headers = new Headers();
  try {
    for (const [key, value] of res.headers.entries?.() ?? []) headers.set(key, value);
    headers.delete("content-encoding");
    headers.delete("content-length");
  } catch { /* headers were broken anyway — an empty Headers still parses */ }
  return new Response(concatChunks(plain), {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * DF-9ROUTER-42: single seam — every response that leaves the proxy-aware
 * engine (proxy, MITM bypass, vercel relay, direct) is checked for a raw gzip
 * body before it reaches a provider .json()/text() consumer.
 *
 * Two defect shapes are covered:
 * 1. `content-encoding: gzip` + raw gzip stream (undici 8 dispatcher path) —
 *    guarded by the header, confirmed by magic bytes.
 * 2. NO headers at all + raw gzip stream — observed in the Next runtime,
 *    whose response re-wrapping can drop the headers entirely; guarded by
 *    sniffing the first bytes of JSON-bound responses (the only consumers
 *    that hit the parse failure). SSE streams (text/event-stream) and other
 *    non-JSON encodings are never peeked, so streaming stays zero-copy.
 */
async function guardGzipResponse(res) {
  let encoding = "";
  let contentType = "";
  try {
    encoding = (res?.headers?.get?.("content-encoding") ?? "").toLowerCase();
    contentType = (res?.headers?.get?.("content-type") ?? "").toLowerCase();
  } catch { /* broken/cross-realm headers — treat as absent */ }

  const hasStreamBody = !!res?.body && typeof res.body.getReader === "function";
  if (!hasStreamBody) return res;

  const headerSaysGzip = GZIP_HEADER_RE.test(encoding);
  const jsonBoundNoEncoding = !encoding && (!contentType || contentType.includes("json"));
  if (!headerSaysGzip && !jsonBoundNoEncoding) return res;

  try {
    return await rebuildGzipResponse(res);
  } catch (e) {
    dbg("PROXY", `gzip guard failed, returning original response: ${e.message}`);
    return res;
  }
}

// ─── Install at most once per global (QA-9ROUTER-18) ────────────────────────
// Tag the wrapper with its inner fetch, then install it only when the current
// global fetch is not already one of our wrappers. A re-evaluated module
// (vi.resetModules, HMR, worker threads) therefore leaves the installed
// wrapper in place instead of stacking another layer on top of it.
patchedFetch[PATCH_MARK] = true;
patchedFetch[INNER_FETCH] = resolveInnerFetch();

if (!isPatchedFetch(globalThis.fetch)) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;
