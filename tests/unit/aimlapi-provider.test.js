import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(async (id) => ({
    id, provider: "aimlapi", authType: "apikey", apiKey: "aiml-test-key", providerSpecificData: {},
  })),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { AIMLAPI_ECDH_CURVE, aimlapiDirectFetch } from "../../open-sse/executors/aimlapi.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers.js";
import { CATALOG_PLUGINS, DEFAULT_PLUGINS, buildManagedMcpServers } from "@/shared/constants/coworkPlugins";

const KEY = "aiml-test-key";
const entry = REGISTRY.find((p) => p.id === "aimlapi");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("AI/ML API provider entry", () => {
  it("registers a named OpenAI-compatible apikey provider with search and fetch", () => {
    expect(entry).toMatchObject({
      id: "aimlapi",
      category: "apikey",
      serviceKinds: ["llm", "webSearch", "webFetch"],
      transport: {
        baseUrl: "https://api.aimlapi.com/v1/chat/completions",
        validateUrl: "https://api.aimlapi.com/v1/key",
      },
      passthroughModels: true,
    });
    expect(entry.display.name).toBe("AI/ML API");
    expect(AI_PROVIDERS.aimlapi?.searchConfig).toEqual(entry.searchConfig);
    expect(getProvidersByKind("webSearch").map((p) => p.id)).toContain("aimlapi");
    expect(getProvidersByKind("webFetch").map((p) => p.id)).toContain("aimlapi");
  });

  it("sends the key only to api.aimlapi.com for chat", () => {
    const ex = new DefaultExecutor("aimlapi");
    const url = new URL(ex.buildUrl("openai/gpt-6-luna", true, 0, { apiKey: KEY }));
    expect(url.hostname).toBe("api.aimlapi.com");
    expect(url.protocol).toBe("https:");
    expect(ex.buildHeaders({ apiKey: KEY }, true).Authorization).toBe(`Bearer ${KEY}`);
    // No partner / source headers for this provider.
    expect(Object.keys(PROVIDERS.aimlapi.headers || {})).toEqual([]);
  });

  it("keeps the default models on chat-completions ids only", () => {
    expect(entry.models.length).toBeGreaterThan(0);
    for (const m of entry.models) expect(m.id).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
  });
});

describe("AI/ML API chat transport", () => {
  it("routes chat through its own direct fetch that also offers P-256", async () => {
    const ex = getExecutor("aimlapi");
    expect(ex.constructor.name).toBe("AimlapiExecutor");
    expect(AIMLAPI_ECDH_CURVE.split(":")).toEqual(["X25519", "P-256"]);
    const spy = vi.spyOn(DefaultExecutor.prototype, "execute").mockResolvedValue({ response: new Response("{}") });
    await ex.execute({ model: "m", body: {}, stream: false, credentials: { apiKey: KEY } });
    expect(spy.mock.calls[0][0].directFetch).toBe(aimlapiDirectFetch);
  });

  it("refuses to send the request to any host other than api.aimlapi.com", async () => {
    await expect(aimlapiDirectFetch("https://api.aimlapi.com.evil.example/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}` },
    })).rejects.toThrow(/refused host/);
  });
});

describe("AI/ML API key check", () => {
  it("checks the key against /v1/key, since /v1/models is public", async () => {
    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const seen = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      seen.push({ url: String(url), auth: init?.headers?.Authorization, directFetch: init?.directFetch });
      return jsonResponse({ title: "Unauthorized" }, 401);
    }));
    const res = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "aimlapi", apiKey: KEY }),
    }));
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(seen).toEqual([{ url: "https://api.aimlapi.com/v1/key", auth: `Bearer ${KEY}`, directFetch: aimlapiDirectFetch }]);
  });
});

describe("AI/ML API model list", () => {
  it("keeps only openai/chat-completions models from the live catalog", async () => {
    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const seen = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      seen.push({ url: String(url), auth: init?.headers?.Authorization, directFetch: init?.directFetch });
      return jsonResponse({ object: "list", data: [
        { id: "openai/gpt-6-luna", type: "openai/chat-completions", info: { name: "GPT-6 Luna" } },
        { id: "flux/schnell", type: "image" },
        { id: "openai/gpt-6.2-sol", type: "openai/responses/submit", info: { name: "GPT-6.2 Sol" } },
      ] });
    }));
    const res = await GET(new Request("http://localhost/api/providers/c1/models"), { params: Promise.resolve({ id: "c1" }) });
    const body = await res.json();
    expect(seen.map((s) => new URL(s.url).hostname)).toEqual(["api.aimlapi.com"]);
    expect(seen[0].url).toBe("https://api.aimlapi.com/v1/models?include=all");
    expect(seen[0].auth).toBe(`Bearer ${KEY}`);
    expect(seen[0].directFetch).toBe(aimlapiDirectFetch);
    expect(body.models.map((m) => [m.id, m.name])).toEqual([["openai/gpt-6-luna", "GPT-6 Luna"]]);
  });
});

describe("AI/ML API Toolbox web search", () => {
  const params = {
    query: "9router",
    maxResults: 3,
    token: KEY,
    country: "US",
    timeRange: "week",
    domainFilter: ["github.com", "-example.com"],
    providerOptions: { baseUrl: "https://evil.example.com/steal" },
  };

  it("builds a tools/run request on the fixed tools.aimlapi.com host", () => {
    const { url, init } = buildSearchRequest({ id: "aimlapi", ...entry.searchConfig }, params);
    expect(new URL(url).hostname).toBe("tools.aimlapi.com");
    expect(url).toBe("https://tools.aimlapi.com/v1/tools/run");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.directFetch).toBe(aimlapiDirectFetch);
    expect(JSON.parse(init.body)).toEqual({
      tool: "context_dev__web_search",
      input: {
        query: "9router",
        numResults: 3,
        includeDomains: ["github.com"],
        excludeDomains: ["example.com"],
        country: "us",
        freshness: "last_week",
      },
      max_cost_usd: 0.05,
    });
  });

  it("normalizes tool output into search results", () => {
    const out = normalizeSearchResponse("aimlapi", {
      status: "completed",
      is_error: false,
      output: { results: [{ url: "https://github.com/decolua/9router", title: "9router", description: "AI router" }] },
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({
      title: "9router",
      url: "https://github.com/decolua/9router",
      snippet: "AI router",
      citation: { provider: "aimlapi", rank: 1 },
    });
  });

  it("does not follow a redirect off tools.aimlapi.com with the key", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ host: new URL(String(url)).hostname, auth: init?.headers?.Authorization });
      return new Response(null, { status: 307, headers: { location: "https://evil.example.com/collect" } });
    }));
    const result = await handleSearchCore({
      body: { query: "9router" },
      provider: AI_PROVIDERS.aimlapi,
      providerConfig: AI_PROVIDERS.aimlapi.searchConfig,
      credentials: { apiKey: KEY },
    });
    expect(result.success).toBe(false);
    expect(calls.map((c) => c.host)).toEqual(["tools.aimlapi.com"]);
  });
});

describe("AI/ML API Toolbox web fetch", () => {
  it("posts the page tool to tools.aimlapi.com and returns markdown", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        status: "completed",
        is_error: false,
        output: { markdown: "# Example Domain", metadata: { title: "Example" } },
        cost: { actual_usd: 0.0026 },
      });
    }));
    const r = await handleFetchCore({
      url: "https://example.com",
      provider: "aimlapi",
      providerConfig: AI_PROVIDERS.aimlapi.fetchConfig,
      credentials: { apiKey: KEY },
    });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      provider: "aimlapi",
      title: "Example",
      content: { format: "markdown", text: "# Example Domain" },
      usage: { fetch_cost_usd: 0.0026 },
    });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).hostname).toBe("tools.aimlapi.com");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.directFetch).toBe(aimlapiDirectFetch);
    expect(calls[0].init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(calls[0].init.body)).toEqual({
      tool: "context_dev__web_scrape_markdown",
      input: { url: "https://example.com" },
      max_cost_usd: 0.05,
    });
  });

  it("does not carry the key to another host on a real redirect", async () => {
    const seen = [];
    const other = http.createServer((req, res) => { seen.push(req.headers.authorization || null); res.end("{}"); });
    await new Promise((r) => other.listen(0, "127.0.0.1", r));
    const tools = http.createServer((req, res) => {
      res.writeHead(307, { location: `http://127.0.0.1:${other.address().port}/collect` });
      res.end();
    });
    await new Promise((r) => tools.listen(0, "127.0.0.1", r));
    try {
      const r = await handleFetchCore({
        url: "https://example.com",
        provider: "aimlapi",
        providerConfig: { ...AI_PROVIDERS.aimlapi.fetchConfig, baseUrl: `http://127.0.0.1:${tools.address().port}/v1/tools/run` },
        credentials: { apiKey: KEY },
      });
      expect(r.success).toBe(false);
      expect(seen).toEqual([]);
    } finally {
      tools.close();
      other.close();
    }
  });
});

describe("AI/ML API MCP catalog entry", () => {
  const mcp = CATALOG_PLUGINS.find((p) => p.name === "aimlapi");

  it("is offered in the catalog but not enabled by default", () => {
    expect(mcp).toMatchObject({ url: "https://mcp.aimlapi.com/mcp", transport: "http", oauth: true });
    expect(DEFAULT_PLUGINS.map((p) => p.name)).not.toContain("aimlapi");
  });

  it("only auto-allows free tools, never paid ones", () => {
    const [server] = buildManagedMcpServers([mcp]);
    for (const paid of ["llm_chat", "tools_run", "image_generate", "video_generate", "embeddings_create", "speech_generate"]) {
      expect(server.toolPolicy[paid]).toBeUndefined();
    }
    expect(server.toolPolicy.models_search).toBe("allow");
  });

  it("shows up first in the Browse registry list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ servers: [], metadata: {} })));
    globalThis.__9routerCoworkMcpRegistryCache = undefined;
    const { GET } = await import("../../src/app/api/cli-tools/cowork-mcp-registry/route.js");
    const res = await GET(new Request("http://localhost/api/cli-tools/cowork-mcp-registry?refresh=1"));
    const body = await res.json();
    expect(body.servers[0]).toMatchObject({ name: "aimlapi", url: "https://mcp.aimlapi.com/mcp", oauth: true });
  });
});
