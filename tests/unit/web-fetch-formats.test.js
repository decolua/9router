import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import firecrawl from "../../open-sse/providers/registry/firecrawl.js";
import jina from "../../open-sse/providers/registry/jina-reader.js";
import tavily from "../../open-sse/providers/registry/tavily.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

function run(provider, format, extra = {}) {
  const config = { firecrawl, "jina-reader": jina, tavily }[provider].fetchConfig;
  return handleFetchCore({ url: "https://example.com", provider, format,
    providerConfig: config, credentials: { apiKey: "test-key" }, ...extra });
}

describe("web fetch output formats (#2239)", () => {
  it.each([
    [undefined, "markdown", "# Hello"],
    ["html", "html", "<p>Hello</p>"],
  ])("uses Firecrawl v2 with format %s", async (format, requestedFormat, content) => {
    fetch.mockResolvedValue(Response.json({
      success: true,
      data: { markdown: "# Hello", html: "<p>Hello</p>", metadata: { title: "Hello" } },
    }));

    const result = await run("firecrawl", format);
    const [endpoint, request] = fetch.mock.calls[0];
    expect(endpoint).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(request.method).toBe("POST");
    expect(request.headers.authorization).toBe("Bearer test-key");
    expect(JSON.parse(request.body)).toEqual({ url: "https://example.com", formats: [requestedFormat] });
    expect(result).toMatchObject({
      success: true,
      data: { title: "Hello", content: { format: requestedFormat, text: content, length: content.length } },
    });
  });

  it("rejects Firecrawl's unsupported text format locally", async () => {
    expect(await run("firecrawl", "text")).toMatchObject({ success: false, status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["html", "<article>Hello</article>"],
    ["text", "Hello"],
    ["markdown", "# Hello"],
    [undefined, "# Hello"],
  ])("asks Jina for %s and returns that content", async (format, content) => {
    fetch.mockImplementation(async (_url, init) => {
      const actualFormat = init.headers["x-respond-with"];
      const expectedFormat = format || "markdown";
      return new Response(actualFormat === expectedFormat ? content : "# Wrong default Markdown");
    });
    const result = await run("jina-reader", format);
    expect(result.success).toBe(true);
    expect(result.data.content).toEqual({ format: format || "markdown", text: content, length: content.length });
    expect(fetch.mock.calls[0][1].headers.authorization).toBe("Bearer test-key");
  });

  it.each(["text", "markdown", undefined])("forwards Tavily format %s", async (format) => {
    fetch.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      const expectedFormat = format || "markdown";
      const content = body.format === expectedFormat ? "requested output" : "wrong default";
      return Response.json({ results: [{ raw_content: content }] });
    });
    const result = await run("tavily", format);
    expect(result.success).toBe(true);
    expect(result.data.content.text).toBe("requested output");
    expect(result.data.content.format).toBe(format || "markdown");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ urls: ["https://example.com"], extract_depth: "basic" });
  });

  it.each([["tavily", "html"], ["jina-reader", "pdf"]])(
    "rejects unsupported %s format %s before sending an upstream request", async (provider, format) => {
      fetch.mockResolvedValue(new Response("ignored"));
      const result = await run(provider, format);
      expect(result).toMatchObject({ success: false, status: 400 });
      expect(result.error).toContain(provider);
      expect(result.error).toContain("Supported:");
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("retains truncation for requested HTML", async () => {
    fetch.mockResolvedValue(new Response("<p>Hello</p>"));
    const result = await run("jina-reader", "html", { maxCharacters: 4 });
    expect(result.data.content).toEqual({ format: "html", text: "<p>H", length: 4 });
  });

  it("preserves provider error responses", async () => {
    fetch.mockResolvedValue(new Response("denied", { status: 403 }));
    expect(await run("jina-reader", "html")).toMatchObject({ success: false, status: 403, error: "denied" });
  });

  it.each(["capacity", "quota exceeded"])("keeps invalid format %s request-scoped", async (format) => {
    const result = await run("tavily", format);
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(checkFallbackError(result.status, result.error, 0, "tavily"))
      .toMatchObject({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
