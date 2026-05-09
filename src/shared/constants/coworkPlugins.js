// Default plugins auto-installed for Claude Cowork (3p mode).
// Exa works without auth; Tavily uses OAuth (DCR auto-flow).
const DEFAULT_PLUGINS = [
  {
    name: "exa",
    title: "Exa",
    description: "Real-time web search and code documentation",
    url: "https://mcp.exa.ai/mcp",
    transport: "http",
    oauth: false,
    toolNames: ["web_search_exa", "web_fetch_exa"],
  },
  {
    name: "tavily",
    title: "Tavily",
    description: "Real-time web search optimized for LLM agents",
    url: "https://mcp.tavily.com/mcp",
    transport: "http",
    oauth: true,
    toolNames: ["tavily_search", "tavily_extract", "tavily_crawl", "tavily_map"],
  },
];

// Build managedMcpServers entries from plugin objects.
// Schema: [{name, url, transport, oauth?, toolPolicy?}]
// toolPolicy maps each tool to "allow" so Claude doesn't prompt.
// Plugin name that's force-installed regardless of user selection.
const ALWAYS_ON = "exa";

function buildManagedMcpServers(plugins) {
  const list = Array.isArray(plugins) ? plugins : [];
  // Force Exa always-on at the front; drop any duplicate from user list.
  const exaDefault = DEFAULT_PLUGINS.find((p) => p.name === ALWAYS_ON);
  const merged = exaDefault ? [exaDefault, ...list.filter((p) => p?.name !== ALWAYS_ON)] : list;
  const out = [];
  const seen = new Set();
  for (const p of merged) {
    if (!p?.name || !p?.url || seen.has(p.name)) continue;
    seen.add(p.name);
    const entry = {
      name: p.name,
      url: p.url,
      transport: p.transport || (/\/sse(\b|\/)/i.test(p.url) ? "sse" : "http"),
    };
    if (p.oauth) entry.oauth = true;
    if (Array.isArray(p.toolNames) && p.toolNames.length > 0) {
      // Strip any pre-existing "{name}-" prefixes (idempotent across re-applies),
      // then emit both bare + single-prefixed variants to match runtime tool naming.
      const prefix = `${p.name}-`;
      const bare = new Set();
      for (const raw of p.toolNames) {
        if (typeof raw !== "string" || !raw) continue;
        let t = raw;
        while (t.startsWith(prefix)) t = t.slice(prefix.length);
        bare.add(t);
      }
      const policy = {};
      for (const t of bare) {
        policy[t] = "allow";
        policy[`${prefix}${t}`] = "allow";
      }
      entry.toolPolicy = policy;
    }
    out.push(entry);
  }
  return out;
}

module.exports = { DEFAULT_PLUGINS, buildManagedMcpServers, ALWAYS_ON };
