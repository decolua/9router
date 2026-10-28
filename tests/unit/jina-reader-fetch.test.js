import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";

const originalFetch = global.fetch;

describe("Jina Reader fetch", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses Jina's JSON POST API instead of embedding the URL in the path", async () => {
    global.fetch.mockResolvedValueOnce(new Response([
      "Title: Example page",
      "",
      "URL Source: https://example.com/article",
      "",
      "Markdown Content:",
      "Hello",
    ].join("\n")));

    const result = await handleFetchCore({
      url: "https://example.com/article",
      format: "markdown",
      provider: "jina-reader",
      providerConfig: { timeoutMs: 30000 },
      credentials: { apiKey: "jina-test-key" },
    });

    expect(result.success).toBe(true);
    expect(result.data.title).toBe("Example page");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [requestUrl, init] = global.fetch.mock.calls[0];
    expect(requestUrl).toBe("https://r.jina.ai/");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer jina-test-key",
    });
    expect(JSON.parse(init.body)).toEqual({ url: "https://example.com/article" });
  });

  it("returns the upstream status and error body", async () => {
    global.fetch.mockResolvedValueOnce(new Response(
      JSON.stringify({ detail: "Payment required" }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    ));

    const result = await handleFetchCore({
      url: "https://example.com/article",
      provider: "jina-reader",
      providerConfig: { timeoutMs: 30000 },
      credentials: { apiKey: "jina-test-key" },
    });

    expect(result).toMatchObject({
      success: false,
      status: 402,
    });
    expect(result.error).toContain("Payment required");
  });
});
