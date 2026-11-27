import { afterEach, describe, expect, it, vi } from "vitest";
import registry from "../../open-sse/providers/registry/index.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { getProvidersByKind } from "@/shared/constants/providers.js";

const connection = vi.hoisted(() => ({
  id: "keenable-connection",
  provider: "keenable",
  authType: "apikey",
  apiKey: "test-key",
  providerSpecificData: {},
}));

vi.mock("next/server", () => ({ NextResponse: { json: Response.json } }));
vi.mock("@/models", () => ({
  getProviderNodeById: vi.fn(),
  getProviderConnectionById: vi.fn(async () => connection),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(async () => connection),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn(async () => ({ ok: true })) }));

const { POST: validateProvider } = await import("../../src/app/api/providers/validate/route.js");
const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

const provider = registry.find(({ id }) => id === "keenable");
const apiKey = "test-key";
const url = "https://example.com/";

afterEach(() => vi.unstubAllGlobals());

describe("Keenable authenticated web provider", () => {
  it("lists the same API-key provider for search and fetch", () => {
    expect(provider).toMatchObject({ authType: "apikey", serviceKinds: ["webSearch", "webFetch"] });
    for (const kind of provider.serviceKinds) {
      expect(getProvidersByKind(kind).some(({ id }) => id === "keenable")).toBe(true);
    }
    expect(provider.searchConfig.validateUrl).toBe("https://api.keenable.ai/v1/auth/user");
  });

  it.each([200, 401, 503])("checks new and saved keys through the identity endpoint (HTTP %i)", async (status) => {
    const upstream = vi.fn(async () => Response.json({}, { status }));
    vi.stubGlobal("fetch", upstream);
    const response = await validateProvider(new Request("http://localhost/api/providers/validate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "keenable", apiKey }),
    }));
    expect(await response.json()).toMatchObject({ valid: status === 200 });
    expect(await testSingleConnection(connection.id)).toMatchObject({ valid: status === 200 });
    expect(upstream).toHaveBeenCalledTimes(2);
    for (const [endpoint, init] of upstream.mock.calls) {
      expect(endpoint).toBe("https://api.keenable.ai/v1/auth/user");
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("x-api-key")).toBe(apiKey);
    }
  });

  it("posts the search with header auth and translates filters", () => {
    const request = buildSearchRequest({ id: "keenable", ...provider?.searchConfig }, {
      query: "example", token: apiKey, maxResults: 3, timeRange: "week",
      domainFilter: ["example.com", "-example.net"], providerOptions: { baseUrl: url },
    });
    expect(request.url).toBe("https://api.keenable.ai/v1/search");
    expect(request.init).toMatchObject({ method: "POST", headers: { "X-API-Key": apiKey } });
    expect(JSON.parse(request.init.body)).toEqual({
      query: "example", max_results: 3, published_after: "7d", site: "example.com", exclude_domains: ["example.net"],
    });
  });

  it("rejects filters that the upstream cannot represent", () => {
    const config = { id: "keenable", ...provider?.searchConfig };
    expect(() => buildSearchRequest(config, { token: apiKey, offset: 1 })).toThrow(/offset/);
    expect(() => buildSearchRequest(config, { token: apiKey, domainFilter: ["a.example", "b.example"] })).toThrow(/include domain/);
  });

  it("normalizes ranked results", () => {
    const published = "2026-11-24T00:00:00Z";
    const result = normalizeSearchResponse("keenable", { results: [{ url, title: "Example", description: "Summary", published_at: published }] }, "example", "web");
    expect(result.results[0]).toMatchObject({ url, title: "Example", snippet: "Summary", published_at: published, citation: { provider: "keenable" } });
  });

  const fetchPage = (key = apiKey) => handleFetchCore({
    url, provider: "keenable", providerConfig: provider?.fetchConfig, credentials: { apiKey: key }, maxCharacters: 7,
  });

  it("posts to the keyed fetch endpoint and normalizes markdown", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({
      results: [{ url, title: "Example", content: "# Example text", author: "Example author" }],
    }));
    vi.stubGlobal("fetch", upstream);
    const result = await fetchPage();
    expect(result).toMatchObject({
      success: true, data: { title: "Example", content: { format: "markdown", text: "# Examp" }, metadata: { author: "Example author" } },
    });
    expect(upstream).toHaveBeenCalledWith("https://api.keenable.ai/v1/fetch", expect.objectContaining({
      method: "POST", redirect: "error", headers: expect.objectContaining({ "X-API-Key": apiKey }),
    }));
    expect(JSON.parse(upstream.mock.calls[0][1].body)).toEqual({ urls: [url], content: { max_chars: 7 } });
  });

  it.each([401, 402, 429])("passes through HTTP %i without a public retry", async (status) => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ error: { message: "Request rejected" } }, { status }));
    vi.stubGlobal("fetch", upstream);
    expect(await fetchPage()).toMatchObject({ success: false, status });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("returns a result-level failure instead of empty markdown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ results: [{ error: { code: "upstream_error", message: "Page unavailable" } }] })));
    expect(await fetchPage()).toMatchObject({ success: false, status: 502, error: "Page unavailable" });
  });

  it("requires a key before making an upstream request", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    expect(await fetchPage("")).toMatchObject({ success: false, status: 401 });
    expect(upstream).not.toHaveBeenCalled();
  });
});
