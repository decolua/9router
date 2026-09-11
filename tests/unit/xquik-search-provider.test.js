import { afterEach, describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers.js";

const CONFIG = {
  id: "xquik",
  baseUrl: "https://xquik.com/api/v1/x/tweets/search",
  method: "GET",
  authType: "apikey",
  searchTypes: ["x"],
  defaultMaxResults: 5,
  maxMaxResults: 100,
  creditsPerResult: 1,
};

const PARAMS = {
  query: "from:github release notes",
  searchType: "x",
  maxResults: 10,
  token: "xq_test_key",
  language: "en",
  providerOptions: { queryType: "Latest", cursor: "next page" },
};

const RESPONSE = {
  tweets: [
    {
      id: "1234567890",
      text: "Release notes are live.",
      createdAt: "2026-08-25T12:00:00Z",
      author: { username: "github", name: "GitHub" },
      media: [{ mediaUrl: "https://pbs.twimg.com/media/example.jpg", type: "photo" }],
    },
  ],
  has_next_page: true,
  next_cursor: "cursor-2",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Xquik search provider", () => {
  it("registers a dedicated X search provider with no-charge key validation", () => {
    const entry = REGISTRY.find((candidate) => candidate.id === "xquik");

    expect(entry).toMatchObject({
      category: "apikey",
      serviceKinds: ["webSearch"],
      searchConfig: {
        authHeader: "x-api-key",
        validateUrl: "https://xquik.com/api/v1/credits",
        searchTypes: ["x"],
        creditsPerResult: 1,
      },
    });
    expect(AI_PROVIDERS.xquik?.searchConfig).toEqual(entry.searchConfig);
    expect(getProvidersByKind("webSearch").map((provider) => provider.id)).toContain("xquik");
  });

  it("builds the documented GET request without putting the key in the URL", () => {
    const request = buildSearchRequest(CONFIG, PARAMS);
    const url = new URL(request.url);

    expect(url.origin + url.pathname).toBe("https://xquik.com/api/v1/x/tweets/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "from:github release notes",
      limit: "10",
      cursor: "next page",
      queryType: "Latest",
      language: "en",
    });
    expect(url.search).not.toContain("xq_test_key");
    expect(request.init).toEqual({
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": "xq_test_key" },
    });
  });

  it("rejects unsupported query types before contacting Xquik", () => {
    expect(() => buildSearchRequest(CONFIG, {
      ...PARAMS,
      providerOptions: { queryType: "Popular" },
    })).toThrow("Xquik queryType must be Latest or Top");
  });

  it("normalizes posts and preserves cursor pagination", () => {
    const normalized = normalizeSearchResponse("xquik", RESPONSE, PARAMS.query, "x");

    expect(normalized.totalResults).toBeNull();
    expect(normalized.pagination).toEqual({ has_more: true, next_cursor: "cursor-2" });
    expect(normalized.results).toHaveLength(1);
    expect(normalized.results[0]).toMatchObject({
      title: "@github on X",
      url: "https://x.com/github/status/1234567890",
      display_url: "x.com/github/status/1234567890",
      snippet: "Release notes are live.",
      published_at: "2026-08-25T12:00:00Z",
      metadata: {
        author: "@github",
        source_type: "x_post",
        image_url: "https://pbs.twimg.com/media/example.jpg",
      },
      citation: { provider: "xquik", rank: 1 },
    });
    expect(normalized.results[0].content).toEqual({
      format: "text",
      text: "Release notes are live.",
      length: 23,
    });
  });

  it("uses the stable status URL when author data is unavailable", () => {
    const normalized = normalizeSearchResponse("xquik", {
      tweets: [{ id: "9876543210", text: "Author data is unavailable." }],
      has_next_page: false,
      next_cursor: "",
    }, PARAMS.query, "x");

    expect(normalized.results[0]).toMatchObject({
      title: "X post",
      url: "https://x.com/i/web/status/9876543210",
      metadata: { author: null, source_type: "x_post" },
    });
    expect(normalized.pagination).toEqual({ has_more: false, next_cursor: null });
  });

  it("reports Xquik credits without claiming an unknown USD cost", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(RESPONSE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const result = await handleSearchCore({
      body: { query: PARAMS.query, max_results: 10, provider_options: PARAMS.providerOptions },
      provider: { id: "xquik" },
      providerConfig: CONFIG,
      credentials: { apiKey: "xq_test_key" },
    });
    const payload = await result.response.json();

    expect(result.success).toBe(true);
    expect(payload.usage).toEqual({
      queries_used: 1,
      search_cost_usd: null,
      provider_credits_used: 1,
    });
    expect(payload.pagination).toEqual({ has_more: true, next_cursor: "cursor-2" });
  });
});
