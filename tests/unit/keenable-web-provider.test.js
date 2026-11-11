import { afterEach, describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { getProvidersByKind } from "@/shared/constants/providers.js";

const provider = REGISTRY.find((entry) => entry.id === "keenable");
const url = "https://example.com/article";

afterEach(() => vi.unstubAllGlobals());

describe("Keenable Search and Fetch", () => {
  it("registers a keyless provider for both kinds", () => {
    expect(provider.serviceKinds).toEqual(["webSearch", "webFetch"]);
    expect(provider.noAuth).toBe(true);
    expect(provider.searchConfig.authType).toBe("none");
    expect(getProvidersByKind("webSearch").some((p) => p.id === "keenable")).toBe(true);
    expect(getProvidersByKind("webFetch").some((p) => p.id === "keenable")).toBe(true);
  });

  it("builds a keyless POST search and maps filters", () => {
    const request = buildSearchRequest({ id: "keenable", ...provider.searchConfig }, {
      query: "sqlite wal", searchType: "web", maxResults: 3,
      domainFilter: ["sqlite.org", "-example.org"], timeRange: "week",
      providerOptions: { baseUrl: "https://example.net/collect" },
    });
    expect(request.url).toBe("https://api.keenable.ai/v1/search/public");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers["X-Keenable-Title"]).toBe("9router");
    expect(request.init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(request.init.body)).toEqual({
      query: "sqlite wal", max_results: 3, site: "sqlite.org",
      exclude_domains: ["example.org"], published_after: "7d",
    });
  });

  it("rejects filters it cannot honor instead of dropping them", () => {
    const base = { query: "q", searchType: "web", maxResults: 5 };
    expect(() => buildSearchRequest({ id: "keenable", ...provider.searchConfig }, { ...base, domainFilter: ["a.com", "b.com"] }))
      .toThrow("one include domain");
    expect(() => buildSearchRequest({ id: "keenable", ...provider.searchConfig }, { ...base, offset: 5 }))
      .toThrow("does not support offset");
  });

  it("normalizes search results", () => {
    const normalized = normalizeSearchResponse("keenable", {
      query: "sqlite wal",
      results: [
        { title: "Write-Ahead Logging", url: "https://sqlite.org/wal.html", description: "", snippet: "WAL is faster", published_at: "2026-01-02" },
        { title: "No snippet", url, description: "Fallback text" },
      ],
    }, "sqlite wal", "web");
    expect(normalized.totalResults).toBe(2);
    expect(normalized.results[0]).toMatchObject({ title: "Write-Ahead Logging", url: "https://sqlite.org/wal.html", snippet: "WAL is faster", published_at: "2026-01-02", position: 1 });
    expect(normalized.results[1].snippet).toBe("Fallback text");
    expect(normalizeSearchResponse("keenable", {}, "q", "web")).toEqual({ results: [], totalResults: 0 });
  });

  it("fetches a page without credentials and maps the content", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      url, title: "Article", content: "# Article\n\nBody", truncated: false, total_chars: 16, author: "Ann",
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleFetchCore({ url, provider: "keenable", providerConfig: provider.fetchConfig, credentials: null, maxCharacters: 5000 });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ provider: "keenable", title: "Article", content: { format: "markdown", text: "# Article\n\nBody" }, metadata: { author: "Ann" } });
    const called = new URL(fetchMock.mock.calls[0][0]);
    expect(called.origin + called.pathname).toBe("https://api.keenable.ai/v1/fetch/public");
    expect(called.searchParams.get("url")).toBe(url);
    expect(called.searchParams.get("max_chars")).toBe("5000");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("surfaces upstream errors and unsupported formats", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Rate limit exceeded" }), {
      status: 429, headers: { "content-type": "application/json" },
    })));
    const limited = await handleFetchCore({ url, provider: "keenable", providerConfig: provider.fetchConfig });
    expect(limited).toMatchObject({ success: false, status: 429, error: "Rate limit exceeded" });
    const html = await handleFetchCore({ url, format: "html", provider: "keenable", providerConfig: provider.fetchConfig });
    expect(html.success).toBe(false);
    expect(html.status).toBe(400);
  });
});
