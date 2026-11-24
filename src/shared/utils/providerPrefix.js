import REGISTRY from "../../../open-sse/providers/registry/index.js";

export const LOCAL_PROVIDER_ALIASES = Object.freeze({
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
});

export const RESERVED_PROVIDER_PREFIXES = new Set(
  Object.keys(LOCAL_PROVIDER_ALIASES).map((prefix) => prefix.toLowerCase())
);

for (const entry of REGISTRY) {
  if (entry.id) RESERVED_PROVIDER_PREFIXES.add(String(entry.id).toLowerCase());
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(String(entry.alias).toLowerCase());
  for (const alias of entry.aliases || []) {
    RESERVED_PROVIDER_PREFIXES.add(String(alias).toLowerCase());
  }
}

export function isReservedProviderPrefix(prefix) {
  const normalized = String(prefix ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  return RESERVED_PROVIDER_PREFIXES.has(normalized);
}
