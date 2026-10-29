import { ROUTE_HEADERS_ENABLED } from "../config/runtimeConfig.js";

const FORWARDED = new Set(["retry-after", "x-should-retry"]);
const FORWARDED_PREFIX = "anthropic-ratelimit-";

export function upstreamResponseHeaders(headers) {
  const out = {};
  if (typeof headers?.forEach !== "function") return out;
  headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (FORWARDED.has(key) || key.startsWith(FORWARDED_PREFIX)) out[key] = value;
  });
  return out;
}

/**
 * Build x-9router-* route info headers for a completed request.
 * Returns an empty object when NINEROUTER_ROUTE_HEADERS=0|false.
 * @param {string} provider  - Provider ID (e.g. "gh")
 * @param {string} model     - Upstream model ID (e.g. "gpt-5.6")
 * @param {string} [combo]   - Combo name, only when a combo resolved the request
 * @param {number} [attempts]- Seats/accounts tried (≥1)
 */
export function routeResponseHeaders(provider, model, combo, attempts) {
  if (!ROUTE_HEADERS_ENABLED) return {};
  const out = {};
  if (provider) out["x-9router-provider"] = String(provider);
  if (model) out["x-9router-model"] = String(model);
  if (combo) out["x-9router-combo"] = String(combo);
  if (attempts != null && attempts >= 1) out["x-9router-attempts"] = String(attempts);
  return out;
}

/**
 * Clone a Response and merge extra headers into it.
 * Used to inject x-9router-* headers onto an already-constructed Response
 * (e.g. combo responses where the body is built before the winning model is known).
 * The original body stream is moved — do not read `original` after this call.
 */
export function cloneResponseWithHeaders(original, extraHeaders) {
  const merged = {};
  if (original.headers) original.headers.forEach((v, k) => { merged[k] = v; });
  Object.assign(merged, extraHeaders);
  return new Response(original.body, { status: original.status, statusText: original.statusText, headers: merged });
}
