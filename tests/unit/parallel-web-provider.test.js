import { afterEach, describe, expect, it, vi } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { POST as validateProvider } from "../../src/app/api/providers/validate/route.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers.js";

const entry = REGISTRY.find((p) => p.id === "parallel");
const config = { id: entry.id, ...entry.searchConfig };
const params = { query: "solid state battery progress", searchType: "web", maxResults: 5, token: "test-key" };
const url = "https://example.com/page";
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const fetchPage = (extra = {}) => handleFetchCore({ url, provider: "parallel", providerConfig: entry.fetchConfig, credentials: { apiKey: "test-key" }, ...extra });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Parallel web provider", () => {
  it("discovers search and fetch with fixed endpoints, no fictitious quota", () => {
    for (const kind of ["webSearch", "webFetch"]) expect(getProvidersByKind(kind).map((p) => p.id)).toContain("parallel");
    expect(AI_PROVIDERS.parallel.searchConfig).toEqual(entry.searchConfig);
    expect(AI_PROVIDERS.parallel.fetchConfig).toEqual(entry.fetchConfig);
    expect(entry.searchConfig.freeMonthlyQuota).toBeUndefined();
    expect(entry.fetchConfig).toMatchObject({ timeoutMs: 60000, maxCharacters: 100000 });
  });

  it.each([422, 401])("validates keys without redirects, upstream %s", async (status) => {
    const fetch = vi.fn(async () => response({}, status)); vi.stubGlobal("fetch", fetch);
    const result = await validateProvider(new Request("http://localhost/api/providers/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "parallel", apiKey: "test-key" }) }));
    expect((await result.json()).valid).toBe(status === 422);
    expect(fetch.mock.calls[0][0]).toBe(config.baseUrl);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { "x-api-key": "test-key" } });
  });

  it.each(["news", "x"])("rejects unsupported search type %s before network", async (search_type) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(entry.searchConfig.searchTypes).toEqual(["web"]);
    const result = await handleSearchCore({ body: { query: params.query, search_type }, provider: entry, providerConfig: entry.searchConfig, credentials: { apiKey: "test-key" } });
    expect(result.status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["html", "text"])("rejects unsupported fetch format %s before network", async (format) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await fetchPage({ format })).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves path prefixes except turbo", () => {
    const domainFilter = ["https://example.com:8443/path/?query=1#fragment"];
    expect(JSON.parse(buildSearchRequest(config, { ...params, domainFilter }).init.body).advanced_settings.source_policy.include_domains).toEqual(["example.com/path"]);
    expect(() => buildSearchRequest(config, { ...params, domainFilter, providerOptions: { mode: "turbo" } })).toThrow("path-prefix");
  });

  it("explicit objective wins over long query", () => {
    expect(JSON.parse(buildSearchRequest(config, { ...params, query: "word ".repeat(50), providerOptions: { objective: "Explicit objective" } }).init.body).objective).toBe("Explicit objective");
  });

  it.each([["2025-03-31", "month", "2025-02-28"], ["2024-03-31", "month", "2024-02-29"], ["2024-02-29", "year", "2023-02-28"]])("clamps %s minus %s", (date, timeRange, expected) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(`${date}T12:00:00Z`));
    expect(JSON.parse(buildSearchRequest(config, { ...params, timeRange }).init.body).advanced_settings.source_policy.after_date).toBe(expected);
  });

  it("sanitizes target failure text without connection cooldown", async () => {
    vi.stubGlobal("fetch", async () => response({ errors: [{ url, error_type: "quota_exceeded", http_status_code: 429, content: "rate limit" }] }));
    const result = await fetchPage();
    expect(result.status).toBe(422); expect(result.error).toContain("error_type: unknown");
    expect(checkFallbackError(result.status, result.error).shouldFallback).toBe(false);
  });

  it("builds GA search; ignores client baseUrl, language, offset", () => {
    const req = buildSearchRequest(config, { ...params, providerOptions: { baseUrl: "https://attacker.example" }, language: "en", offset: 2 });
    expect(req.url).toBe("https://api.parallel.ai/v1/search");
    expect(req.init.method).toBe("POST");
    expect(req.init.headers).toEqual({ "Content-Type": "application/json", "x-api-key": "test-key" });
    expect(JSON.parse(req.init.body)).toEqual({ search_queries: [params.query], mode: "fast", advanced_settings: { max_results: 5 } });
  });

  it("never follows a search redirect with the stored key", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 307, headers: { location: "https://attacker.example" } }));
    vi.stubGlobal("fetch", fetch);
    const result = await handleSearchCore({ body: { query: params.query }, provider: entry, providerConfig: entry.searchConfig, credentials: { apiKey: "test-key" } });
    expect(result.success).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://api.parallel.ai/v1/search");
  });

  it("maps advanced mode, excerpt budget, domains, date, location, session", () => {
    const req = buildSearchRequest(config, { ...params, country: "UK", timeRange: "week", domainFilter: ["https://example.com:443/path", "-https://excluded.com"], contentOptions: { max_characters: 1200 }, providerOptions: { mode: "advanced", session_id: "session" } });
    expect(JSON.parse(req.init.body)).toMatchObject({ mode: "advanced", session_id: "session", advanced_settings: { max_results: 5, excerpt_settings: { max_chars_per_result: 1200 }, location: "gb", source_policy: { include_domains: ["example.com/path"], exclude_domains: ["excluded.com"], after_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } } });
  });

  it("uses objective and word-boundary query for long queries", () => {
    const query = "battery technology ".repeat(30).trim();
    const body = JSON.parse(buildSearchRequest(config, { ...params, query }).init.body);
    expect(body.objective).toBe(query);
    expect(body.search_queries[0].length).toBeLessThanOrEqual(200);
    expect(query.startsWith(`${body.search_queries[0]} `)).toBe(true);
  });

  it("rejects oversized queries before network", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = await handleSearchCore({ body: { query: "a".repeat(5001) }, provider: entry, providerConfig: entry.searchConfig, credentials: { apiKey: "test-key" } });
    expect(result.status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 21])("rejects invalid builder result limit %s", (maxResults) => {
    expect(() => buildSearchRequest(config, { ...params, maxResults })).toThrow("max_results");
  });
  it("rejects domain, objective and session limits", () => {
    expect(() => buildSearchRequest(config, { ...params, domainFilter: Array(201).fill("example.com") })).toThrow("domain_filter");
    expect(() => buildSearchRequest(config, { ...params, providerOptions: { objective: "a".repeat(5001) } })).toThrow("objective");
    expect(() => buildSearchRequest(config, { ...params, providerOptions: { session_id: "a".repeat(1001) } })).toThrow("session_id");
  });

  it("normalizes single/multiple nonempty excerpts, missing title, date and citation", () => {
    const { results } = normalizeSearchResponse("parallel", { results: [{ url, title: "Title", publish_date: "2026-01-15", excerpts: ["", "A", " ", "B"] }, { url, excerpts: ["Only"] }] });
    expect(results[0]).toMatchObject({ title: "Title", snippet: "A", published_at: "2026-01-15", position: 1, content: { format: "markdown", text: "A\n\nB" }, citation: { provider: "parallel", rank: 1 } });
    expect(results[1]).toMatchObject({ title: "", snippet: "Only", position: 2, content: { text: "Only" }, citation: { rank: 2 } });
  });

  it.each([["fast", 5, 0.001], ["turbo", 11, 0.002], ["basic", 5, 0.005], ["advanced", 12, 0.007], ["invalid", 5, 0.001]])("charges actual %s mode with %s results", async (mode, count, cost) => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ results: Array.from({ length: count }, () => ({ url, excerpts: ["A"] })) })));
    const result = await handleSearchCore({ body: { query: params.query, max_results: 20, provider_options: { mode } }, provider: entry, providerConfig: entry.searchConfig, credentials: { apiKey: "test-key" } });
    expect(result.success).toBe(true); expect(result.data.usage.search_cost_usd).toBeCloseTo(cost);
  });

  it("fetches bounded markdown, title, date, cost", async () => {
    const fetch = vi.fn(async () => response({ results: [{ url, title: "Title", publish_date: "2026-01-15", full_content: "# Content" }] }));
    vi.stubGlobal("fetch", fetch);
    const result = await fetchPage({ maxCharacters: 1000 });
    expect(fetch.mock.calls[0][0]).toBe("https://api.parallel.ai/v1/extract");
    expect(fetch.mock.calls[0][1].redirect).toBe("error");
    expect(fetch.mock.calls[0][1].headers["x-api-key"]).toBe("test-key");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ urls: [url], advanced_settings: { full_content: { max_chars_per_result: 1000 } } });
    expect(result.data).toMatchObject({ title: "Title", content: { format: "markdown", text: "# Content" }, metadata: { published_at: "2026-01-15" }, usage: { fetch_cost_usd: 0.001 } });
  });

  it.each([undefined, null, 0, 100001])("defaults/caps fetch budget %s (0 = dashboard default)", async (maxCharacters) => {
    const fetch = vi.fn(async () => response({ results: [{ url, excerpts: ["A", "B"] }] })); vi.stubGlobal("fetch", fetch);
    const result = await fetchPage({ maxCharacters });
    expect(JSON.parse(fetch.mock.calls[0][1].body).advanced_settings.full_content).toEqual({ max_chars_per_result: 100000 });
    expect(result.data.content.text).toBe("A\n\nB");
  });
  it.each([-1, 1.5, "100"])("rejects invalid fetch budget %s before network", async (maxCharacters) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await fetchPage({ maxCharacters })).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ full_content: "" }, { full_content: "  \n" }, { full_content: " ", excerpts: [" "] }, {}])("treats empty content %j as no content", async (page) => {
    vi.stubGlobal("fetch", async () => response({ results: [{ url, ...page }] }));
    expect(await fetchPage({})).toMatchObject({ success: false, status: 502 });
  });
  it("falls back to excerpts when full_content is blank", async () => {
    vi.stubGlobal("fetch", async () => response({ results: [{ url, full_content: " ", excerpts: ["A"] }] }));
    expect((await fetchPage({})).data.content.text).toBe("A");
  });

  it("surfaces per-URL HTTP-200 failure", async () => {
    vi.stubGlobal("fetch", async () => response({ results: [], errors: [{ url, error_type: "fetch_error", http_status_code: 403 }] }));
    const result = await fetchPage();
    expect(result).toMatchObject({ success: false, status: 422 });
    expect(result.error).not.toContain(url); expect(result.error).toContain("fetch_error"); expect(result.error).toContain("403");
    expect(checkFallbackError(result.status, result.error).shouldFallback).toBe(false);
  });
  it.each([{ results: [] }, { results: [{ url, title: "Malformed" }] }])("rejects malformed success", async (data) => {
    vi.stubGlobal("fetch", async () => response(data)); expect((await fetchPage()).status).toBe(502);
  });
  it.each([401, 429])("preserves upstream %s and error reference", async (status) => {
    vi.stubGlobal("fetch", async () => response({ type: "error", error: { message: "Rejected", ref_id: "ref-test" } }, status));
    expect(await fetchPage()).toMatchObject({ success: false, status, error: "Rejected (ref_id: ref-test)" });
  });
});
