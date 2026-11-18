import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handleSearch: vi.fn(), handleFetch: vi.fn() }));
vi.mock("@/sse/handlers/search.js", () => ({ handleSearch: mocks.handleSearch }));
vi.mock("@/sse/handlers/fetch.js", () => ({ handleFetch: mocks.handleFetch }));

const search = await import("@/app/api/v1/search/[...model]/route.js");
const fetchRoute = await import("@/app/api/v1/web/fetch/[...model]/route.js");
const post = (url, body) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("Open WebUI web routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps the search path model and count to the existing search handler", async () => {
    mocks.handleSearch.mockResolvedValue(Response.json({ results: [{ url: "https://example.com", title: "Example", snippet: "Text" }] }));
    const response = await search.POST(post("http://localhost/v1/search/tavily", { query: "test", count: 3 }), { params: Promise.resolve({ model: ["tavily"] }) });
    expect(await response.json()).toEqual([{ link: "https://example.com", title: "Example", snippet: "Text" }]);
    expect(await mocks.handleSearch.mock.calls[0][0].json()).toMatchObject({ model: "tavily", query: "test", max_results: 3 });
  });

  it("maps each loader URL through the existing fetch handler", async () => {
    mocks.handleFetch.mockResolvedValueOnce(Response.json({ url: "https://one.test", title: "One", content: { text: "First" }, metadata: { language: "en" } }))
      .mockResolvedValueOnce(Response.json({ url: "https://two.test", content: { text: "Second" }, metadata: {} }));
    const response = await fetchRoute.POST(post("http://localhost/v1/web/fetch/jina-reader", { urls: ["https://one.test", "https://two.test"] }), { params: Promise.resolve({ model: ["jina-reader"] }) });
    expect(await response.json()).toEqual([
      { page_content: "First", metadata: { language: "en", source: "https://one.test", title: "One" } },
      { page_content: "Second", metadata: { source: "https://two.test" } },
    ]);
    expect(await mocks.handleFetch.mock.calls[0][0].json()).toMatchObject({ model: "jina-reader", url: "https://one.test" });
  });
});
