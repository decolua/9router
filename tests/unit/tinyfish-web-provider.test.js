import { afterEach, describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { getProvidersByKind } from "@/shared/constants/providers.js";

const provider = REGISTRY.find((entry) => entry.id === "tinyfish");
const url = "https://example.com/article";

afterEach(() => vi.unstubAllGlobals());

describe("TinyFish Search and Fetch", () => {
  it("registers both kinds on one API-key provider", () => {
    expect(provider.serviceKinds).toEqual(["webSearch", "webFetch"]);
    expect(getProvidersByKind("webSearch").some((p) => p.id === "tinyfish")).toBe(true);
    expect(getProvidersByKind("webFetch").some((p) => p.id === "tinyfish")).toBe(true);
    expect(provider.searchConfig.validateUrl).toContain("/usage?limit=1");
  });

  it("builds GET search with header auth and maps results", () => {
    const request = buildSearchRequest({ id: "tinyfish", ...provider.searchConfig }, {
      query: "latest release", searchType: "news", token: "secret", maxResults: 5,
      country: "TR", language: "tr", domainFilter: ["example.com", "-other.com"], offset: 5,
    });
    const parsed = new URL(request.url);
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      query: "latest release", domain_type: "news", location: "TR", language: "tr",
      include_domains: "example.com", exclude_domains: "other.com", page: "0",
    });
    expect(request.url).not.toContain("secret");
    expect(request.init.headers["X-API-Key"]).toBe("secret");
    expect(buildSearchRequest({ id: "tinyfish", ...provider.searchConfig }, {
      query: "release", searchType: "web", token: "secret", maxResults: 5,
      providerOptions: { baseUrl: "https://example.org/collect" },
    }).url.startsWith(provider.searchConfig.baseUrl)).toBe(true);
    const normalized = normalizeSearchResponse("tinyfish", {
      total_results: 1, results: [{ title: "Article", url, snippet: "Preview", date: "2026-09-01" }],
    }, "latest release", "news");
    expect(normalized.totalResults).toBe(1);
    expect(normalized.results[0]).toMatchObject({ title: "Article", url, snippet: "Preview", published_at: "2026-09-01" });
  });

  it("applies offset within TinyFish fixed-size result pages", async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ title: `Article ${i}`, url: `${url}/${i}`, snippet: "Preview" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: entries, total_results: 10 }), {
      headers: { "content-type": "application/json" },
    })));
    const result = await handleSearchCore({
      body: { query: "release", max_results: 2, offset: 3 },
      provider: { id: "tinyfish" }, providerConfig: provider.searchConfig,
      credentials: { apiKey: "secret" },
    });
    expect(result.success).toBe(true);
    expect(result.data.results.map((entry) => entry.title)).toEqual(["Article 3", "Article 4"]);
    expect(new URL(vi.mocked(fetch).mock.calls[0][0]).searchParams.get("page")).toBe("0");
  });

  it("rejects offsets that would silently omit requested results", () => {
    const params = { query: "release", searchType: "web", token: "secret", maxResults: 5, offset: 8 };
    expect(() => buildSearchRequest({ id: "tinyfish", ...provider.searchConfig }, params))
      .toThrow("TinyFish search offset and max_results must fit within one page");
  });

  it("maps fetched content and treats HTTP 200 per-URL errors as failures", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{ url, title: "Article", text: "# Article", language: "en" }], errors: [],
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { url, provider: "tinyfish", providerConfig: provider.fetchConfig, credentials: { apiKey: "secret" } };
    const result = await handleFetchCore(input);
    expect(result.data).toMatchObject({ provider: "tinyfish", title: "Article", content: { text: "# Article" }, metadata: { language: "en" } });
    expect(fetchMock.mock.calls[0][0]).toBe(provider.fetchConfig.baseUrl);
    expect(fetchMock.mock.calls[0][1].headers["X-API-Key"]).toBe("secret");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ urls: [url], format: "markdown" });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [], errors: [{ url, error: "bot_blocked" }] }), {
      headers: { "content-type": "application/json" },
    }));
    expect(await handleFetchCore(input)).toMatchObject({ success: false, status: 502, error: "TinyFish fetch failed: bot_blocked" });

    expect(await handleFetchCore({ ...input, format: "text" })).toMatchObject({ success: false, status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
      status: 401, headers: { "content-type": "application/json" },
    }));
    expect(await handleFetchCore(input)).toMatchObject({ success: false, status: 401 });
  });
});
