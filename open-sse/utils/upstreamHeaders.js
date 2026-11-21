import { getCapabilitiesForModel } from "../providers/capabilities.js";

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

export function resolvedModelHeaders(provider, model) {
  if (!model || typeof model !== "string") return {};
  const headers = {
    "x-9router-model": provider ? `${provider}/${model}` : model,
  };
  const caps = getCapabilitiesForModel(provider, model);
  if (Number.isFinite(caps?.contextWindow) && caps.contextWindow > 0) {
    headers["x-9router-context-window"] = String(caps.contextWindow);
  }
  return headers;
}
