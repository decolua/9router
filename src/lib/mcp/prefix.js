/**
 * Prefix handling for MCP gateway tool namespacing.
 *
 * Every active MCP server gets a short, human-readable, UNIQUE prefix
 * prepended to its tool names in the aggregated gateway (e.g. `bro__navigate`).
 * The prefix lets the gateway route a `prefix__tool` call back to the correct
 * upstream server, so it MUST be unique across servers. Prefixes are persisted
 * per server so they stay stable as servers are added/removed/toggled.
 */

const MAX_PREFIX_LENGTH = 12;

// Friendly base prefixes for well-known servers; falls back to the first three
// alphanumeric characters of the name.
const SPECIAL_PREFIXES = [
  ["testsprite", "ts"],
  ["sentry", "sr"],
  ["firecrawl", "fc"],
  ["puppeteer", "pp"],
  ["astro", "ad"],
  ["stitch", "st"],
  ["github", "gh"],
  ["tavily", "tv"],
];

/** Compute the (non-unique) base prefix from a server name. */
export function computeBasePrefix(name) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  for (const [needle, prefix] of SPECIAL_PREFIXES) {
    if (n.includes(needle)) return prefix;
  }
  return n.slice(0, 3) || "mcp";
}

/**
 * Sanitize a user-provided prefix override: lowercase, alphanumeric only,
 * capped length. Returns "" when nothing usable remains.
 */
export function normalizePrefix(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, MAX_PREFIX_LENGTH);
}

/**
 * Given a desired base and a set of already-taken prefixes, return a unique
 * prefix by appending the smallest free number on collision
 * (`bro` → `bro2` → `bro3`).
 */
export function makeUniquePrefix(base, taken) {
  const b = base || "mcp";
  if (!taken.has(b)) return b;
  let i = 2;
  while (taken.has(`${b}${i}`)) i++;
  return `${b}${i}`;
}

/**
 * Resolve a server's tool-name prefix. Prefer the persisted unique prefix;
 * fall back to a computed base for any server not yet backfilled.
 */
export function getServerPrefix(server) {
  if (server && server.prefix) return server.prefix;
  return computeBasePrefix(server?.name);
}

/**
 * Split a namespaced identifier like `prefix__tool_name` into its parts.
 * Returns `null` if the name has no `__` separator.
 */
export function parsePrefixedName(name) {
  const match = String(name || "").match(/^(.+?)__(.+)$/);
  if (!match) return null;
  return { prefix: match[1], tail: match[2] };
}

/**
 * Strip the prefix from a namespaced name. Returns the original name when no
 * prefix separator is present.
 */
export function stripPrefix(name) {
  const parsed = parsePrefixedName(name);
  return parsed ? parsed.tail : name;
}

/**
 * Locate the active server that owns a given prefix. Matches on the persisted
 * (or computed) prefix first, then falls back to a case-insensitive name match.
 */
export function findServerByPrefix(servers, prefix) {
  const normalized = normalizePrefix(prefix);
  const lowerPrefix = String(prefix || "").toLowerCase();
  return (
    servers.find((s) => {
      const serverPrefix = getServerPrefix(s);
      return (
        serverPrefix === normalized ||
        String(s.name || "").toLowerCase() === lowerPrefix
      );
    }) || null
  );
}
