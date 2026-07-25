import { describe, it, expect } from "vitest";

import { buildSearchRequest, parseDomainFilter } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";

// ── Request Builder Tests ─────────────────────────────────────────────

describe("Firecrawl search request builder (v2 flat schema)", () => {
  const config = {
    id: "firecrawl",
    baseUrl: "https://api.firecrawl.dev/v2/search",
    method: "POST",
  };

  const baseParams = {
    query: "AI agent frameworks",
    searchType: "web",
    maxResults: 5,
    token: "fc-test-key",
  };

  it("builds a correct POST request with Bearer auth and v2 URL", () => {
    const { url, init } = buildSearchRequest(config, baseParams);
    expect(url).toBe("https://api.firecrawl.dev/v2/search");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe("Bearer fc-test-key");

    const body = JSON.parse(init.body);
    expect(body.query).toBe("AI agent frameworks");
    expect(body.limit).toBe(5);
    expect(body.sources).toEqual(["web"]);
    expect(body.searchOptions).toBeUndefined();
  });

  it("maps news searchType to flat sources field", () => {
    const { init } = buildSearchRequest(config, { ...baseParams, searchType: "news" });
    const body = JSON.parse(init.body);
    expect(body.sources).toEqual(["news"]);
    expect(body.searchOptions).toBeUndefined();
  });

  it("sets sources to [web] for default web searchType", () => {
    const { init } = buildSearchRequest(config, { ...baseParams, searchType: "web" });
    const body = JSON.parse(init.body);
    expect(body.sources).toEqual(["web"]);
  });

  it("includes domain filters as flat top-level fields", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      domainFilter: ["arxiv.org", "-wikipedia.com"],
    });
    const body = JSON.parse(init.body);
    expect(body.includeDomains).toEqual(["arxiv.org"]);
    expect(body.excludeDomains).toEqual(["wikipedia.com"]);
    expect(body.searchOptions).toBeUndefined();
  });

  it("handles only includes (no excludes)", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      domainFilter: ["arxiv.org", "nature.com"],
    });
    const body = JSON.parse(init.body);
    expect(body.includeDomains).toEqual(["arxiv.org", "nature.com"]);
    expect(body.excludeDomains).toBeUndefined();
  });

  it("handles only excludes (no includes)", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      domainFilter: ["-wikipedia.com", "-reddit.com"],
    });
    const body = JSON.parse(init.body);
    expect(body.includeDomains).toBeUndefined();
    expect(body.excludeDomains).toEqual(["wikipedia.com", "reddit.com"]);
  });

  it("adds country as flat top-level field (no lang in v2)", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      country: "US",
      language: "en",
    });
    const body = JSON.parse(init.body);
    expect(body.country).toBe("US");
    expect(body.lang).toBeUndefined(); // v2 has no lang field
    expect(body.searchOptions).toBeUndefined();
  });

  it("maps timeRange to flat tbs parameter", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      timeRange: "month",
    });
    const body = JSON.parse(init.body);
    expect(body.tbs).toBe("qdr:m");
    expect(body.searchOptions).toBeUndefined();
  });

  it("maps all timeRange values correctly", () => {
    const cases = [
      ["day", "qdr:d"],
      ["week", "qdr:w"],
      ["month", "qdr:m"],
      ["year", "qdr:y"],
    ];
    for (const [input, expected] of cases) {
      const { init } = buildSearchRequest(config, { ...baseParams, timeRange: input });
      const body = JSON.parse(init.body);
      expect(body.tbs).toBe(expected);
    }
  });

  it("does not add tbs for 'any' timeRange", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      timeRange: "any",
    });
    const body = JSON.parse(init.body);
    expect(body.tbs).toBeUndefined();
  });

  it("does not add tbs for unknown timeRange value", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      timeRange: "decade",
    });
    const body = JSON.parse(init.body);
    expect(body.tbs).toBeUndefined();
  });

  it("adds scrapeOptions when contentOptions.full_page is true", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      contentOptions: { full_page: true, format: "markdown" },
    });
    const body = JSON.parse(init.body);
    expect(body.scrapeOptions).toBeDefined();
    expect(body.scrapeOptions.formats).toEqual(["markdown"]);
    expect(body.scrapeOptions.onlyMainContent).toBe(true);
  });

  it("defaults to html format when contentOptions.format is undefined", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      contentOptions: { full_page: true },
    });
    const body = JSON.parse(init.body);
    expect(body.scrapeOptions.formats).toEqual(["html"]);
  });

  it("does not add scrapeOptions when contentOptions.full_page is false", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      contentOptions: { full_page: false, format: "markdown" },
    });
    const body = JSON.parse(init.body);
    expect(body.scrapeOptions).toBeUndefined();
  });

  it("does not add scrapeOptions when contentOptions is undefined", () => {
    const { init } = buildSearchRequest(config, baseParams);
    const body = JSON.parse(init.body);
    expect(body.scrapeOptions).toBeUndefined();
  });

  it("respects baseUrl override from providerOptions (e.g. self-hosted)", () => {
    const { url } = buildSearchRequest(config, {
      ...baseParams,
      providerOptions: { baseUrl: "http://localhost:3002/v2/search" },
    });
    expect(url).toBe("http://localhost:3002/v2/search");
  });

  it("respects baseUrl override from providerSpecificData", () => {
    const { url } = buildSearchRequest(config, {
      ...baseParams,
      providerSpecificData: { baseUrl: "https://custom.firecrawl.example.com/v2/search" },
    });
    expect(url).toBe("https://custom.firecrawl.example.com/v2/search");
  });

  it("strips trailing slash from baseUrl", () => {
    const { url } = buildSearchRequest(
      { ...config, baseUrl: "https://api.firecrawl.dev/v2/search/" },
      baseParams
    );
    expect(url).toBe("https://api.firecrawl.dev/v2/search");
  });

  it("combines all options without losing fields (merge regression test)", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      searchType: "news",
      domainFilter: ["arxiv.org", "-wikipedia.com"],
      country: "DE",
      timeRange: "week",
      contentOptions: { full_page: true, format: "markdown" },
    });
    const body = JSON.parse(init.body);
    expect(body.query).toBe("AI agent frameworks");
    expect(body.limit).toBe(5);
    expect(body.sources).toEqual(["news"]);
    expect(body.includeDomains).toEqual(["arxiv.org"]);
    expect(body.excludeDomains).toEqual(["wikipedia.com"]);
    expect(body.country).toBe("DE");
    expect(body.tbs).toBe("qdr:w");
    expect(body.scrapeOptions.formats).toEqual(["markdown"]);
    // v2: no lang field
    expect(body.lang).toBeUndefined();
  });

  it("passes maxResults as limit", () => {
    const { init } = buildSearchRequest(config, {
      ...baseParams,
      maxResults: 100,
    });
    const body = JSON.parse(init.body);
    expect(body.limit).toBe(100);
  });
});

// ── Normalizer Tests (v2 response shape) ──────────────────────────────

describe("Firecrawl v2 search response normalizer", () => {
  it("normalizes a standard v2 web search response", () => {
    const mockResponse = {
      success: true,
      data: {
        web: [
          {
            title: "Article One",
            description: "A description of article one",
            url: "https://example.com/article1",
            markdown: "# Article One\n\nSome content here.",
            metadata: { title: "Article One", sourceURL: "https://example.com/article1" },
          },
          {
            title: "Article Two",
            description: "A description of article two",
            url: "https://example.com/article2",
          },
        ],
      },
      creditsUsed: 2,
    };

    const { results, totalResults } = normalizeSearchResponse("firecrawl", mockResponse, "test query", "web");

    expect(results).toHaveLength(2);
    expect(totalResults).toBe(2);

    expect(results[0].title).toBe("Article One");
    expect(results[0].url).toBe("https://example.com/article1");
    expect(results[0].snippet).toBe("A description of article one");
    expect(results[0].content).not.toBeNull();
    expect(results[0].content.format).toBe("markdown");
    expect(results[0].content.text).toContain("# Article One");
    expect(results[0].content.length).toBeGreaterThan(0);
    expect(results[0].position).toBe(1);
    expect(results[0].citation.provider).toBe("firecrawl");
    expect(results[0].score).toBeNull();

    expect(results[1].title).toBe("Article Two");
    expect(results[1].url).toBe("https://example.com/article2");
    expect(results[1].content).toBeNull();
    expect(results[1].position).toBe(2);
  });

  it("normalizes a v2 news search response (uses snippet and date)", () => {
    const mockResponse = {
      success: true,
      data: {
        news: [
          {
            title: "Breaking News",
            snippet: "A short snippet of the news",
            url: "https://news.example.com/story1",
            date: "2026-07-25T08:00:00Z",
            imageUrl: "https://news.example.com/img.jpg",
            position: 1,
          },
        ],
      },
      creditsUsed: 1,
    };

    const { results, totalResults } = normalizeSearchResponse("firecrawl", mockResponse, "breaking news", "news");

    expect(results).toHaveLength(1);
    expect(totalResults).toBe(1);
    expect(results[0].title).toBe("Breaking News");
    expect(results[0].url).toBe("https://news.example.com/story1");
    expect(results[0].snippet).toBe("A short snippet of the news");
    expect(results[0].published_at).toBe("2026-07-25T08:00:00Z");
  });

  it("handles empty web results", () => {
    const mockResponse = { success: true, data: { web: [] } };
    const { results, totalResults } = normalizeSearchResponse("firecrawl", mockResponse, "test", "web");
    expect(results).toEqual([]);
    expect(totalResults).toBe(0);
  });

  it("handles empty news results", () => {
    const mockResponse = { success: true, data: { news: [] } };
    const { results, totalResults } = normalizeSearchResponse("firecrawl", mockResponse, "test", "news");
    expect(results).toEqual([]);
    expect(totalResults).toBe(0);
  });

  it("handles missing data field gracefully", () => {
    const { results, totalResults } = normalizeSearchResponse("firecrawl", { success: true }, "test", "web");
    expect(results).toEqual([]);
    expect(totalResults).toBe(0);
  });

  it("handles null response", () => {
    const { results, totalResults } = normalizeSearchResponse("firecrawl", null, "test", "web");
    expect(results).toEqual([]);
    expect(totalResults).toBe(0);
  });

  it("handles data field that is not an object", () => {
    const { results } = normalizeSearchResponse("firecrawl", { data: "not-an-object" }, "test", "web");
    expect(results).toEqual([]);
  });

  it("handles data field that is null", () => {
    const { results } = normalizeSearchResponse("firecrawl", { data: null }, "test", "web");
    expect(results).toEqual([]);
  });

  it("handles items with missing fields", () => {
    const mockResponse = {
      success: true,
      data: {
        web: [
          { url: "https://example.com/no-title" },
          { title: "No URL" },
          {},
        ],
      },
    };

    const { results } = normalizeSearchResponse("firecrawl", mockResponse, "test", "web");
    expect(results).toHaveLength(3);

    expect(results[0].url).toBe("https://example.com/no-title");
    expect(results[0].title).toBe("");
    expect(results[0].snippet).toBe("");
    expect(results[0].position).toBe(1);

    expect(results[1].title).toBe("No URL");
    expect(results[1].url).toBe("");
    expect(results[1].position).toBe(2);

    expect(results[2].title).toBe("");
    expect(results[2].url).toBe("");
    expect(results[2].position).toBe(3);
  });

  it("handles markdown: null explicitly (content should be null)", () => {
    const mockResponse = {
      success: true,
      data: { web: [{ url: "https://example.com", title: "Test", markdown: null }] },
    };
    const { results } = normalizeSearchResponse("firecrawl", mockResponse, "test", "web");
    expect(results[0].content).toBeNull();
  });

  it("handles markdown: empty string (falsy → content null)", () => {
    const mockResponse = {
      success: true,
      data: { web: [{ url: "https://example.com", title: "Test", markdown: "" }] },
    };
    const { results } = normalizeSearchResponse("firecrawl", mockResponse, "test", "web");
    expect(results[0].content).toBeNull();
  });

  it("handles description: null (snippet should be empty string)", () => {
    const mockResponse = {
      success: true,
      data: { web: [{ url: "https://example.com", title: "Test", description: null }] },
    };
    const { results } = normalizeSearchResponse("firecrawl", mockResponse, "test", "web");
    expect(results[0].snippet).toBe("");
  });

  it("sets correct display_url from full URL", () => {
    const mockResponse = {
      success: true,
      data: { web: [{ url: "https://www.example.com/path?query=1", title: "Test" }] },
    };
    const { results } = normalizeSearchResponse("firecrawl", mockResponse, "test", "web");
    expect(results[0].display_url).toBe("example.com/path");
  });

  it("verifies metadata fields are null for Firecrawl", () => {
    const mockResponse = {
      success: true,
      data: { web: [{ url: "https://example.com", title: "Test", description: "Desc" }] },
    };
    const { results } = normalizeSearchResponse("firecrawl", mockResponse, "test", "web");
    expect(results[0].metadata.author).toBeNull();
    expect(results[0].metadata.source_type).toBeNull();
    expect(results[0].metadata.image_url).toBeNull();
  });

  it("verifies citation shape", () => {
    const mockResponse = {
      success: true,
      data: { web: [{ url: "https://example.com", title: "Test" }] },
    };
    const { results } = normalizeSearchResponse("firecrawl", mockResponse, "test", "web");
    expect(results[0].citation.provider).toBe("firecrawl");
    expect(results[0].citation.rank).toBe(1);
    expect(results[0].citation.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles large result set with correct positions", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: `Result ${i}`,
    }));
    const mockResponse = { success: true, data: { web: items } };
    const { results, totalResults } = normalizeSearchResponse("firecrawl", mockResponse, "test", "web");
    expect(results).toHaveLength(50);
    expect(totalResults).toBe(50);
    expect(results[0].position).toBe(1);
    expect(results[49].position).toBe(50);
  });

  it("falls back to news array when web is empty but news has results", () => {
    const mockResponse = {
      success: true,
      data: {
        web: [],
        news: [{ title: "News Fallback", snippet: "Snippet", url: "https://news.example.com" }],
      },
    };
    const { results } = normalizeSearchResponse("firecrawl", mockResponse, "test", "web");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("News Fallback");
  });
});

// ── Integration: Builder + Normalizer round-trip ────────────────────────

describe("Firecrawl search builder + normalizer round-trip", () => {
  const config = {
    id: "firecrawl",
    baseUrl: "https://api.firecrawl.dev/v2/search",
    method: "POST",
  };

  it("builder produces valid request and normalizer handles v2 response shape", () => {
    const params = {
      query: "test query",
      searchType: "web",
      maxResults: 3,
      token: "fc-key",
    };

    const { init } = buildSearchRequest(config, params);
    const body = JSON.parse(init.body);
    expect(body.query).toBe("test query");
    expect(body.limit).toBe(3);
    expect(body.sources).toEqual(["web"]);

    // Simulate v2 response shape
    const mockApiResponse = {
      success: true,
      data: {
        web: [
          { url: "https://result.com", title: "Result", description: "Desc" },
        ],
      },
    };

    const { results } = normalizeSearchResponse("firecrawl", mockApiResponse, "test query", "web");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Result");
  });

  it("round-trip with news searchType preserves sources in body and normalizes news fields", () => {
    const { init } = buildSearchRequest(config, {
      query: "breaking news",
      searchType: "news",
      maxResults: 5,
      token: "fc-key",
    });
    const body = JSON.parse(init.body);
    expect(body.sources).toEqual(["news"]);

    const mockApiResponse = {
      success: true,
      data: {
        news: [
          { title: "Breaking", snippet: "News snippet", url: "https://news.com/1", date: "2026-07-25T10:00:00Z" },
        ],
      },
    };
    const { results } = normalizeSearchResponse("firecrawl", mockApiResponse, "breaking news", "news");
    expect(results[0].snippet).toBe("News snippet");
    expect(results[0].published_at).toBe("2026-07-25T10:00:00Z");
  });

  it("round-trip with domain filters + scrapeOptions", () => {
    const { init } = buildSearchRequest(config, {
      query: "AI research",
      searchType: "web",
      maxResults: 10,
      token: "fc-key",
      domainFilter: ["arxiv.org"],
      contentOptions: { full_page: true, format: "markdown" },
    });
    const body = JSON.parse(init.body);
    expect(body.includeDomains).toEqual(["arxiv.org"]);
    expect(body.scrapeOptions.formats).toEqual(["markdown"]);

    const mockResponse = {
      success: true,
      data: {
        web: [
          { url: "https://arxiv.org/abs/2401.001", title: "Paper", description: "Abstract", markdown: "# Paper\n\nContent" },
        ],
      },
    };
    const { results } = normalizeSearchResponse("firecrawl", mockResponse, "AI research", "web");
    expect(results[0].content.format).toBe("markdown");
    expect(results[0].content.text).toContain("# Paper");
  });
});

// ── Domain filter helper ───────────────────────────────────────────────

describe("parseDomainFilter (used by Firecrawl builder)", () => {
  it("separates includes and excludes", () => {
    const { includes, excludes } = parseDomainFilter(["example.com", "-bad.com", "good.org"]);
    expect(includes).toEqual(["example.com", "good.org"]);
    expect(excludes).toEqual(["bad.com"]);
  });

  it("handles empty input", () => {
    const { includes, excludes } = parseDomainFilter([]);
    expect(includes).toEqual([]);
    expect(excludes).toEqual([]);
  });

  it("handles undefined input", () => {
    const { includes, excludes } = parseDomainFilter(undefined);
    expect(includes).toEqual([]);
    expect(excludes).toEqual([]);
  });
});