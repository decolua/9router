/**
 * Static tool filter: declarative include/exclude rules evaluated before
 * any tool enters the BM25 session index.
 *
 * Config shape (all fields optional):
 *   excludeServers           string[]  – strip all tools from these MCP servers
 *   excludeTools             string[]  – exact name exclusions
 *   includeOnlyServers       string[]  – whitelist by server (OR with includeOnlyTools)
 *   includeOnlyTools         string[]  – whitelist by exact name
 *   alwaysInclude            string[]  – never filtered regardless of other rules
 *   excludeDescriptionPattern  string  – regex: exclude tools matching description
 *   includeOnlyDescriptionPattern string – regex: exclude tools NOT matching description
 */

function getToolName(t) {
  return t?.name || t?.function?.name || "";
}

function getToolDesc(t) {
  return t?.description || t?.function?.description || "";
}

// Match a tool name against a server spec.
// Accepts bare server name ("filesystem") or prefixed form ("mcp__filesystem__*").
function matchesServer(name, server) {
  if (server.endsWith("*")) {
    return name.startsWith(server.slice(0, -1));
  }
  if (server.includes("__")) {
    return name === server || name.startsWith(server + "__");
  }
  return name.startsWith(`mcp__${server}__`);
}

export function toolFilter(tools, config) {
  if (!Array.isArray(tools) || tools.length === 0) return tools;
  if (!config) return tools;

  const {
    excludeServers = [],
    excludeTools = [],
    includeOnlyServers = [],
    includeOnlyTools = [],
    alwaysInclude = [],
    excludeDescriptionPattern = null,
    includeOnlyDescriptionPattern = null,
  } = config;

  const alwaysSet = new Set(alwaysInclude);
  const excludeSet = new Set(excludeTools);
  const includeOnlySet = new Set(includeOnlyTools);

  const excludeDescRe = excludeDescriptionPattern ? new RegExp(excludeDescriptionPattern, "i") : null;
  const includeDescRe = includeOnlyDescriptionPattern ? new RegExp(includeOnlyDescriptionPattern, "i") : null;

  const hasServerWhitelist = includeOnlyServers.length > 0;
  const hasToolWhitelist = includeOnlyTools.length > 0;

  return tools.filter((tool) => {
    const name = getToolName(tool);
    const desc = getToolDesc(tool);

    if (alwaysSet.has(name)) return true;
    if (excludeSet.has(name)) return false;
    if (excludeServers.some((s) => matchesServer(name, s))) return false;
    if (excludeDescRe && excludeDescRe.test(desc)) return false;

    if (hasServerWhitelist || hasToolWhitelist) {
      const serverOk = hasServerWhitelist && includeOnlyServers.some((s) => matchesServer(name, s));
      const toolOk = hasToolWhitelist && includeOnlySet.has(name);
      if (!serverOk && !toolOk) return false;
    }

    if (includeDescRe && !includeDescRe.test(desc)) return false;

    return true;
  });
}
