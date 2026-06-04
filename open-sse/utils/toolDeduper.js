/**
 * Strip built-in/duplicate tools when equivalent MCP tools are present.
 * Goal: reduce tool definitions token bloat for Claude clients.
 */

const DEDUP_RULES = [
  {
    // Exa MCP present → drop built-in web tools (Exa is preferred).
    triggers: ["mcp__exa__web_search_exa", "mcp__exa__web_fetch_exa"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Tavily MCP present → drop built-in web tools.
    triggers: ["mcp__tavily__tavily_search", "mcp__tavily__tavily_extract"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Browser MCP present → drop Cowork's duplicate Claude_in_Chrome connector.
    triggers: [/^mcp__browsermcp__/],
    strip: [/^mcp__Claude_in_Chrome__/],
  },
];

function getToolName(t) {
  return t?.name || t?.function?.name || "";
}

function matches(name, pattern) {
  if (typeof pattern === "string") return name === pattern;
  return pattern instanceof RegExp ? pattern.test(name) : false;
}

function dedupeTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stripped: [] };
  const names = tools.map(getToolName);
  const toStrip = new Set();
  for (const rule of DEDUP_RULES) {
    const hasTrigger = names.some((n) => rule.triggers.some((p) => matches(n, p)));
    if (!hasTrigger) continue;
    for (const n of names) {
      if (rule.strip.some((p) => matches(n, p))) toStrip.add(n);
    }
  }
  if (toStrip.size === 0) return { tools, stripped: [] };
  const out = tools.filter((t) => !toStrip.has(getToolName(t)));
  return { tools: out, stripped: Array.from(toStrip) };
}

export { dedupeTools };
