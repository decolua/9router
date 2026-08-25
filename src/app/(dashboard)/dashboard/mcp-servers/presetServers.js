// Static configuration data for the MCP Servers dashboard page.
// Extracted from McpServersPageClient.js to keep the component lean.

export const SERVER_TYPES = [
  {
    id: "remote-http",
    label: "Remote (HTTP)",
    icon: "cloud",
    description: "Streamable HTTP transport — sends JSON-RPC via POST",
  },
  {
    id: "remote-sse",
    label: "Remote (SSE)",
    icon: "cell_tower",
    description: "Server-Sent Events transport — subscribes to SSE stream",
  },
  {
    id: "local-stdio",
    label: "Local (stdio)",
    icon: "terminal",
    description: "Spawns a local process and communicates via stdin/stdout",
  },
];

export const PRESET_SERVERS = [
  {
    name: "SkillMD",
    type: "remote-http",
    url: "https://mcp.skillmds.dev/api/mcp",
    description:
      "Search 350K+ SKILL.md agent skills and retrieve full instructions https://www.skillmds.dev ",
    headers: { Authorization: "Bearer YOUR_API_KEY" },
    toolNames: [
      "search_skills",
      "get_skill_details",
      "list_occupations",
      "get_popular_skills",
      "get_install_instructions",
    ],
  },
  {
    name: "Exa Search",
    type: "remote-http",
    url: "https://mcp.exa.ai/mcp",
    description: "Real-time web search and code documentation",
    toolNames: ["web_search_exa", "web_fetch_exa"],
  },
  {
    name: "Tavily",
    type: "remote-http",
    url: "https://mcp.tavily.com/mcp",
    description: "Real-time web search optimized for LLM agents",
    headers: { Authorization: "Bearer " },
    toolNames: ["tavily_search", "tavily_extract"],
  },
  {
    name: "Google Stitch",
    type: "remote-http",
    url: "https://stitch.googleapis.com/mcp",
    description:
      "Generate UI screens and manage design systems with Google Stitch",
    headers: { "X-Goog-Api-Key": "" },
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
  {
    name: "Astro Docs",
    type: "remote-http",
    url: "https://mcp.docs.astro.build/mcp",
    description: "Astro documentation and resources search",
  },
  {
    name: "Sentry",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@sentry/mcp-server"],
    env: { SENTRY_ACCESS_TOKEN: "" },
    description:
      "Retrieve error data, manage projects, and analyze application issues via Sentry API",
  },
  {
    name: "Firecrawl",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    env: { FIRECRAWL_API_KEY: "" },
    description: "Convert websites into LLM-ready markdown or structured data",
  },
  {
    name: "Git",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@cyanheads/git-mcp-server"],
    description:
      "Run git commands, inspect repository history, diffs, and staging",
  },
  {
    name: "Puppeteer",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@hisma/server-puppeteer"],
    description: "Web scraping and browser automation using headless Chrome",
  },
  {
    name: "PostgreSQL",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    description: "Inspect and query PostgreSQL databases",
  },
  {
    name: "Memory",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    description: "Graph-based knowledge representation and semantic memory",
  },
  {
    name: "Filesystem",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    description: "Read/write files on local filesystem",
  },
  {
    name: "GitHub",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    description: "GitHub API integration",
  },
  {
    name: "CodeGraph",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@colbymchenry/codegraph", "serve", "--mcp"],
    description:
      "Local semantic code intelligence using tree-sitter, SQLite, and AST relationships",
    setupNote:
      "Install CodeGraph globally on your system first, then run `codegraph init` in your project to activate the CodeGraph MCP.",
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
    name: "TestSprite",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@testsprite/testsprite-mcp@latest"],
    env: { API_KEY: "" },
    description: "Autonomous AI-powered testing assistant for IDEs",
  },
  {
    name: "Vercel",
    type: "remote-http",
    url: "https://mcp.vercel.com",
    description:
      "Deployments, projects, domains, and Vercel analytics management",
  },
  {
    name: "Postman",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@postman/postman-mcp-server"],
    description: "API development, contract testing, and collection management",
  },
  {
    name: "Insomnia",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "mcp-insomnia"],
    description: "API design, debugging, and collection runner",
  },
  {
    name: "Supabase (Remote)",
    type: "remote-http",
    url: "https://mcp.supabase.com/mcp",
    description:
      "Database schema inspection, query execution, and migration management",
  },
  {
    name: "Supabase (Local)",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@supabase/mcp-server-supabase"],
    description: "Inspect and query local Supabase database schemas",
  },
  {
    name: "Playwright",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    description:
      "Web scraping, end-to-end testing, and browser automation via Playwright accessibility trees",
  },
  {
    name: "Netlify",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@netlify/mcp@latest"],
    description:
      "Deployments, serverless functions, form submissions, and Netlify hosting management",
  },
  {
    name: "Render (Remote)",
    type: "remote-http",
    url: "https://mcp.render.com/mcp",
    headers: { Authorization: "Bearer " },
    description:
      "Cloud infrastructure manager for Render services, deploys, and logs",
  },
  {
    name: "Render (Local)",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@niyogi/render-mcp@latest"],
    env: { RENDER_API_KEY: "" },
    description: "Local CLI bridge for Render infrastructure management",
  },
  {
    name: "n8n",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "n8n-mcp"],
    env: { N8N_API_URL: "", N8N_API_KEY: "" },
    description: "Control, trigger, and manage your n8n workflow automations",
  },
  {
    name: "Grafana",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@leval/mcp-grafana"],
    env: { GRAFANA_URL: "", GRAFANA_SERVICE_ACCOUNT_TOKEN: "" },
    description:
      "Query Grafana metrics, Loki logs, dashboards, and alerting rules",
  },
  {
    name: "Lighthouse",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "lighthouse-mcp"],
    description:
      "Run Google Lighthouse audits for performance, accessibility, SEO, and Core Web Vitals",
  },
  {
    name: "PageSpeed Insights",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "pagespeed-insights-mcp"],
    env: { GOOGLE_API_KEY: "" },
    description:
      "Google PageSpeed Insights API auditor for Core Web Vitals, metrics, and screenshots",
  },
  {
    name: "Figma",
    type: "remote-http",
    url: "https://mcp.figma.com/mcp",
    description:
      "Read Figma design tokens, component hierarchies, layouts, and write content to Figma files",
  },
  {
    name: "GTmetrix",
    type: "remote-http",
    url: "https://api.gtmetrix.com/mcp",
    headers: { Authorization: "Basic " },
    description:
      "Integrate GTmetrix API for speed audits, CrUX reports, and performance monitoring",
  },
  {
    name: "Chrome DevTools",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "chrome-devtools-mcp@latest"],
    description:
      "Inspect, debug, profile, and interact with a live Chrome browser via Chrome DevTools Protocol",
  },
  {
    name: "Ahrefs",
    type: "remote-http",
    url: "https://api.ahrefs.com/mcp/mcp",
    description:
      "Search Ahrefs SEO metrics, crawl audits, keyword volumes, backlink parameters, and competitor analysis",
  },
  {
    name: "Builder.io DevTools",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "@builder.io/dev-tools@latest", "mcp"],
    description:
      "Connect AI coding agents to Builder.io branches and design system documentation",
  },
  {
    name: "Builder.io CMS",
    type: "remote-http",
    url: "https://cdn.builder.io/api/v1/mcp/builder-content",
    headers: { Authorization: "Bearer " },
    description:
      "Expose Builder.io CMS content spaces, models, and entries to AI agents",
  },
  {
    name: "PlanetScale",
    type: "remote-http",
    url: "https://mcp.pscale.dev/mcp/planetscale",
    description:
      "Manage PlanetScale databases, branches, schemas, and query Insights data",
  },
  {
    name: "Flowbite / Tailwind",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "flowbite-mcp"],
    description:
      "Access Flowbite component library snippets and Figma-to-Tailwind-code conversion assets",
  },
  {
    name: "LangSmith",
    type: "local-stdio",
    command: "npx",
    args: ["-y", "langsmith-mcp-server"],
    env: { LANGSMITH_API_KEY: "" },
    description:
      "Trace, debug, and optimize AI backend chains, prompts, and LLM calls in LangSmith",
  },
  {
    name: "Dart",
    type: "local-stdio",
    command: "dart",
    args: ["mcp-server"],
    env: {},
    description:
      "Dart and Flutter tooling — analyze, run, test, and inspect Dart/Flutter projects via the Dart SDK",
  },
];
