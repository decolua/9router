// Default remote plugins for Claude Cowork (3p managedMcpServers, HTTPS only).
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
    toolNames: [
      "tavily_search",
      "tavily_extract",
      "tavily_crawl",
      "tavily_map",
    ],
  },
  {
    name: "stitch",
    title: "Google Stitch",
    description:
      "Connect to Google Stitch design projects and generate UI screens",
    url: "https://stitch.googleapis.com/mcp",
    transport: "http",
    oauth: false,
    toolNames: [
      "list_projects",
      "list_screens",
      "get_project",
      "get_screen",
      "create_project",
      "generate_screen_from_text",
      "edit_screens",
      "generate_variants",
      "create_design_system",
      "update_design_system",
      "apply_design_system",
      "upload_design_md",
      "create_design_system_from_design_md",
      "list_design_systems",
    ],
  },
];

// Local stdio plugins bridged via inline SSE endpoint on the app's port.
const LOCAL_STDIO_PLUGINS = [
  {
    name: "sentry",
    title: "Sentry",
    description:
      "Retrieve error data, manage projects, and analyze application issues via Sentry API",
    command: "npx",
    args: ["-y", "@sentry/mcp-server"],
  },
  {
    name: "firecrawl",
    title: "Firecrawl",
    description: "Convert websites into LLM-ready markdown or structured data",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
  },
  {
    name: "git",
    title: "Git",
    description:
      "Run git commands, inspect repository history, diffs, and staging",
    command: "npx",
    args: ["-y", "@cyanheads/git-mcp-server"],
  },
  {
    name: "puppeteer",
    title: "Puppeteer",
    description: "Web scraping and browser automation using headless Chrome",
    command: "npx",
    args: ["-y", "@hisma/server-puppeteer"],
  },
  {
    name: "postgresql",
    title: "PostgreSQL",
    description: "Inspect and query PostgreSQL databases",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
  },
  {
    name: "memory",
    title: "Memory",
    description: "Graph-based knowledge representation and semantic memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
  },
  {
    name: "filesystem",
    title: "Filesystem",
    description: "Read/write files on local filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  },
  {
    name: "github",
    title: "GitHub",
    description: "GitHub API integration",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
  },
  {
    name: "browsermcp",
    title: "Browser MCP",
    description: "Control your running Chrome (requires Chrome extension)",
    extensionUrl:
      "https://chromewebstore.google.com/detail/browser-mcp-automate-your/bjfgambnhccakkhmkepdoekmckoijdlc",
    command: "npx",
    args: ["-y", "@browsermcp/mcp@latest"],
    toolNames: [
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_screenshot",
      "browser_get_console_logs",
      "browser_wait",
      "browser_press_key",
      "browser_go_back",
      "browser_go_forward",
    ],
  },
  {
    name: "codegraph",
    title: "CodeGraph",
    description:
      "Local semantic code intelligence using tree-sitter, SQLite, and ASTs.",
    command: "npx",
    args: ["-y", "@colbymchenry/codegraph", "serve", "--mcp"],
    toolNames: [
      "codegraph_explore",
      "codegraph_node",
      "codegraph_search",
      "codegraph_callers",
      "codegraph_callees",
      "codegraph_impact",
      "codegraph_files",
      "codegraph_status",
    ],
  },
  {
    name: "testsprite",
    title: "TestSprite",
    description: "Autonomous AI-powered testing assistant for IDEs",
    command: "npx",
    args: ["-y", "@testsprite/testsprite-mcp@latest"],
  },
  {
    name: "postman",
    title: "Postman",
    description: "API development, contract testing, and collection management",
    command: "npx",
    args: ["-y", "@postman/postman-mcp-server"],
  },
  {
    name: "insomnia",
    title: "Insomnia",
    description: "API design, debugging, and collection runner",
    command: "npx",
    args: ["-y", "mcp-insomnia"],
  },
  {
    name: "supabase-local",
    title: "Supabase (Local)",
    description: "Inspect and query local Supabase database schemas",
    command: "npx",
    args: ["-y", "@supabase/mcp-server-supabase"],
  },

  {
    name: "browserbase-local",
    title: "Browserbase (Local)",
    description: "Local headless browser manager and stagehand web interaction",
    command: "npx",
    args: ["-y", "@browserbasehq/mcp"],
  },
  {
    name: "playwright",
    title: "Playwright",
    description:
      "Web scraping, end-to-end testing, and browser automation via Playwright accessibility trees",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
  },
  {
    name: "netlify",
    title: "Netlify",
    description:
      "Deployments, serverless functions, form submissions, and Netlify hosting management",
    command: "npx",
    args: ["-y", "@netlify/mcp@latest"],
  },
  {
    name: "render-local",
    title: "Render (Local)",
    description: "Local CLI bridge for Render infrastructure management",
    command: "npx",
    args: ["-y", "@niyogi/render-mcp@latest"],
  },
  {
    name: "n8n",
    title: "n8n",
    description: "Control, trigger, and manage your n8n workflow automations",
    command: "npx",
    args: ["-y", "n8n-mcp"],
  },
  {
    name: "grafana",
    title: "Grafana",
    description:
      "Query Grafana metrics, Loki logs, dashboards, and alerting rules",
    command: "npx",
    args: ["-y", "@leval/mcp-grafana"],
  },
  {
    name: "lighthouse",
    title: "Lighthouse",
    description:
      "Run Google Lighthouse audits for performance, accessibility, SEO, and Core Web Vitals",
    command: "npx",
    args: ["-y", "lighthouse-mcp"],
  },
  {
    name: "pagespeed-insights",
    title: "PageSpeed Insights",
    description:
      "Google PageSpeed Insights API auditor for Core Web Vitals, metrics, and screenshots",
    command: "npx",
    args: ["-y", "pagespeed-insights-mcp"],
  },
  {
    name: "chrome-devtools",
    title: "Chrome DevTools",
    description:
      "Inspect, debug, profile, and interact with a live Chrome browser via Chrome DevTools Protocol",
    command: "npx",
    args: ["-y", "chrome-devtools-mcp@latest"],
  },
  {
    name: "builder-devtools",
    title: "Builder.io DevTools",
    description:
      "Connect AI coding agents to Builder.io branches and design system documentation",
    command: "npx",
    args: ["-y", "@builder.io/dev-tools@latest", "mcp"],
  },
  {
    name: "flowbite-tailwind",
    title: "Flowbite / Tailwind",
    description:
      "Access Flowbite component library snippets and Figma-to-Tailwind-code conversion assets",
    command: "npx",
    args: ["-y", "flowbite-mcp"],
  },
  {
    name: "langsmith",
    title: "LangSmith",
    description:
      "Trace, debug, and optimize AI backend chains, prompts, and LLM calls in LangSmith",
    command: "npx",
    args: ["-y", "langsmith-mcp-server"],
  },
  {
    name: "dart",
    title: "Dart",
    description:
      "Dart and Flutter tooling — analyze, run, test, and inspect Dart/Flutter projects via the Dart SDK",
    command: "dart",
    args: ["mcp-server"],
  },
];

function buildManagedMcpServers(plugins) {
  const list = Array.isArray(plugins) ? plugins : [];
  const out = [];
  const seen = new Set();
  for (const p of list) {
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

module.exports = {
  DEFAULT_PLUGINS,
  LOCAL_STDIO_PLUGINS,
  buildManagedMcpServers,
};
