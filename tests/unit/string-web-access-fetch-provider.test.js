import { afterEach, describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers.js";

const CONFIG = {
  baseUrl: "https://request.usestring.ai/v1/fetch",
  timeoutMs: 30000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("String Web Access fetch provider", () => {
  it("registers String Web Access as a web fetch provider", () => {
    const entry = REGISTRY.find((candidate) => candidate.id === "string-web-access");

    expect(entry).toMatchObject({
      category: "apikey",
      serviceKinds: ["webFetch"],
      fetchConfig: {
        baseUrl: "https://request.usestring.ai/v1/fetch",
        method: "POST",
        authHeader: "bearer",
        formats: ["markdown"],
      },
    });
    expect(AI_PROVIDERS["string-web-access"]?.fetchConfig).toEqual(entry.fetchConfig);
    expect(getProvidersByKind("webFetch").map((provider) => provider.id)).toContain("string-web-access");
  });

  it("calls String with bearer auth and normalizes the markdown response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("# Example Domain\n\nHello from String", {
      status: 200,
      headers: { "Content-Type": "text/markdown" },
    })));

    const result = await handleFetchCore({
      url: "https://example.com",
      format: "markdown",
      maxCharacters: 20,
      provider: "string-web-access",
      providerConfig: CONFIG,
      credentials: { apiKey: "string-test-key" },
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = global.fetch.mock.calls[0];
    expect(requestUrl).toBe("https://request.usestring.ai/v1/fetch");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer string-test-key",
    });
    expect(JSON.parse(init.body)).toEqual({
      url: "https://example.com",
      format: "markdown",
    });
    expect(result.data).toMatchObject({
      provider: "string-web-access",
      url: "https://example.com",
      title: "Example Domain",
      content: { format: "markdown", text: "# Example Domain\n\nHe", length: 20 },
      usage: { fetch_cost_usd: null },
    });
  });

  it("returns the upstream status and error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "Invalid API key" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    )));

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "string-web-access",
      providerConfig: CONFIG,
      credentials: { apiKey: "bad-key" },
    });

    expect(result).toMatchObject({
      success: false,
      status: 401,
      error: "Invalid API key",
    });
  });
});
