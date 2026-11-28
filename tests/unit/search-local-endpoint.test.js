import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";

// A self-hosted SearXNG is configured by the deployment (SEARXNG_URL / registry
// baseUrl) and legitimately lives on loopback or a private Docker network. The
// SSRF guard must protect caller-supplied targets, not the admin-configured one.

const SEARXNG_CONFIG = {
  id: "searxng",
  baseUrl: "http://localhost:8888/search",
  method: "GET",
  authType: "none",
  searchTypes: ["web"],
  defaultMaxResults: 5,
  maxMaxResults: 50,
  timeoutMs: 10000,
};

function jsonResults() {
  return new Response(JSON.stringify({
    results: [{ title: "Article", url: "https://example.com/a", content: "Preview" }],
  }), { headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("SearXNG on an internal endpoint", () => {
  it("reaches the admin-configured loopback endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResults());
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleSearchCore({
      body: { query: "latest release" },
      provider: { id: "searxng" },
      providerConfig: SEARXNG_CONFIG,
      credentials: null,
    });

    expect(result.success, result.error).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.data.results[0].url).toBe("https://example.com/a");
  });

  it("still blocks a caller-supplied internal baseUrl", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleSearchCore({
      body: { query: "steal", provider_options: { baseUrl: "http://169.254.169.254/latest" } },
      provider: { id: "searxng" },
      providerConfig: SEARXNG_CONFIG,
      credentials: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Blocked URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still blocks a redirect from the trusted endpoint to another internal host", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).startsWith("http://localhost:8888")) {
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:22/" } });
      }
      return jsonResults();
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleSearchCore({
      body: { query: "latest release" },
      provider: { id: "searxng" },
      providerConfig: SEARXNG_CONFIG,
      credentials: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Blocked URL/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
