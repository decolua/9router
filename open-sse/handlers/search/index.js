/**
 * Search Dispatcher — routes /v1/search requests to dedicated search APIs
 * or chat-based LLM search wrappers, with retry-friendly error envelope.
 *
 * Dependency map:
 *   provider.searchConfig    → dedicated search API (callers + normalizers)
 *   provider.searchViaChat   → wrap chat-completions (chatSearch.js)
 */

import { buildSearchRequest } from "./callers.js";
import { normalizeSearchResponse } from "./normalizers.js";
import { handleChatSearch } from "./chatSearch.js";

const GLOBAL_TIMEOUT_MS = 15000;
const NON_RETRIABLE = new Set([400, 401, 403, 404]);

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/** Normalize and validate query string. */
function sanitizeQuery(query) {
  if (CONTROL_CHAR_RE.test(query)) return { error: "Query contains invalid control characters" };
  const clean = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean) return { error: "Query is empty after normalization" };
  return { clean };
}

// Strip non-ASCII chars from header values (HTTP headers must be ByteString).
function sanitizeHeaders(headers) {
  if (!headers) return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = typeof v === "string" ? v.replace(/[^\x00-\xFF]/g, "").trim() : v;
  }
  return out;
}

/** Build a JSON Response wrapper used by the auth layer. */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

/** Wrap an error result with a Response object so the auth wrapper can return it directly. */
function errorResult(status, error) {
  return {
    success: false,
    status,
    error,
    response: jsonResponse({ error: { message: error, code: status } }, status)
  };
}

/** Wrap a success payload. */
function successResult(data) {
  return { success: true, data, response: jsonResponse(data, 200) };
}

/**
 * Run a single dedicated search provider attempt.
 * @returns {Promise<{success:boolean, status?:number, error?:string, data?:object}>}
 */
async function tryDedicatedProvider({ provider, providerConfig, body, credentials, log, globalStartTime }) {
  const startTime = Date.now();
  const token = credentials?.apiKey || credentials?.accessToken || undefined;

  if (providerConfig.authType !== "none" && !token) {
    return { success: false, status: 401, error: `No credentials for provider: ${provider.id}` };
  }

  const params = {
    query: body.query,
    searchType: body.search_type || (providerConfig.searchTypes?.[0] || "web"),
    maxResults: Math.min(body.max_results || providerConfig.defaultMaxResults || 5, providerConfig.maxMaxResults || 100),
    token,
    country: body.country,
    language: body.language,
    timeRange: body.time_range,
    offset: body.offset,
    domainFilter: body.domain_filter,
    contentOptions: body.content_options,
    providerOptions: body.provider_options,
    providerSpecificData: credentials?.providerSpecificData
  };

  let url, init;
  try {
    ({ url, init } = buildSearchRequest({ id: provider.id, ...providerConfig }, params));
  } catch (err) {
    return { success: false, status: 400, error: err?.message || `Invalid request for ${provider.id}` };
  }

  // Timeout = min(provider timeout, remaining global)
  const remaining = GLOBAL_TIMEOUT_MS - (Date.now() - globalStartTime);
  const timeout = Math.min(providerConfig.timeoutMs || 10000, Math.max(remaining, 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  log?.info?.("SEARCH", `${provider.id} | "${params.query.slice(0, 80)}" | type=${params.searchType}`);

  try {
    const resp = await fetch(url, { ...init, headers: sanitizeHeaders(init.headers), signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      log?.error?.("SEARCH", `${provider.id} ${resp.status}: ${errText.slice(0, 200)}`);
      return { success: false, status: resp.status, error: `${provider.id} returned ${resp.status}: ${errText.slice(0, 200)}` };
    }
    const data = await resp.json();
    const normalized = normalizeSearchResponse(provider.id, data, params.query, params.searchType);
    const results = normalized.results.slice(0, params.maxResults);
    const duration = Date.now() - startTime;

    return {
      success: true,
      data: {
        provider: provider.id,
        query: params.query,
        results,
        answer: null,
        usage: { queries_used: 1, search_cost_usd: providerConfig.costPerQuery || 0 },
        metrics: { response_time_ms: duration, upstream_latency_ms: duration, total_results_available: normalized.totalResults },
        errors: []
      }
    };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === "AbortError";
    const status = isTimeout ? 504 : 502;
    log?.error?.("SEARCH", `${provider.id} ${isTimeout ? "timeout" : "error"}: ${err.message}`);
    return { success: false, status, error: `${provider.id} ${isTimeout ? "timeout" : "error"}: ${err.message}` };
  }
}

/**
 * Core search handler. Dispatches to dedicated API or chat-based LLM.
 * Same calling convention as handleEmbeddingsCore: returns `{success, response, status?, error?}`.
 *
 * @param {object}   options
 * @param {object}   options.body            Sanitized body from auth wrapper
 * @param {object}   options.provider        Provider entry from AI_PROVIDERS
 * @param {object}   [options.providerConfig] Provider's searchConfig (if dedicated)
 * @param {object|null} options.credentials  Provider credentials
 * @param {object}   [options.log]           Logger
 */
export async function handleSearchCore({ body, provider, providerConfig, credentials, log }) {
  const globalStartTime = Date.now();

  // 1. Sanitize query
  const { clean, error: sanitizeError } = sanitizeQuery(body.query || "");
  if (sanitizeError) return errorResult(400, sanitizeError);
  const normalizedBody = { ...body, query: clean };

  // 2. Route: dedicated search API takes priority over chat-based
  let result;
  if (providerConfig) {
    result = await tryDedicatedProvider({
      provider,
      providerConfig,
      body: normalizedBody,
      credentials,
      log,
      globalStartTime
    });
  } else if (provider.searchViaChat) {
    result = await handleChatSearch({
      provider: provider.id,
      query: clean,
      maxResults: normalizedBody.max_results,
      model: provider.searchViaChat.defaultModel,
      credentials,
      log
    });
  } else {
    return errorResult(400, `Provider ${provider.id} does not support web search`);
  }

  if (result.success) return successResult(result.data);

  // 3. Failover within global timeout for retriable errors
  if (
    !NON_RETRIABLE.has(result.status || 0) &&
    Date.now() - globalStartTime < GLOBAL_TIMEOUT_MS &&
    provider.searchViaChat &&
    providerConfig
  ) {
    log?.warn?.("SEARCH", `${provider.id} dedicated failed (${result.status}), falling back to chat-based search`);
    const fallback = await handleChatSearch({
      provider: provider.id,
      query: clean,
      maxResults: normalizedBody.max_results,
      model: provider.searchViaChat.defaultModel,
      credentials,
      log
    });
    if (fallback.success) return successResult(fallback.data);
  }

  return errorResult(result.status || 502, result.error || "Search failed");
}
