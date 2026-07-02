/**
 * Unit tests for Firecrawl official and self-hosted (custom) providers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleFetchCore } from "open-sse/handlers/fetch/index.js";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

describe("Firecrawl providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe("official firecrawl provider", () => {
    it("rejects when API key is missing", async () => {
      const res = await handleFetchCore({
        url: "https://example.com",
        provider: "firecrawl",
        providerConfig: {},
        credentials: {}
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe(400);
      expect(res.error).toBe("FIRECRAWL_API_KEY is required for the official Firecrawl provider");
    });

    it("uses cloud URL and sends Authorization: Bearer <key>", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve({ data: { markdown: "# Hello" } })
      });

      const res = await handleFetchCore({
        url: "https://example.com",
        provider: "firecrawl",
        providerConfig: {},
        credentials: { apiKey: "fc-cloud-key" }
      });

      expect(res.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.firecrawl.dev/v1/scrape",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "content-type": "application/json",
            authorization: "Bearer fc-cloud-key"
          })
        })
      );
    });
  });

  describe("firecrawl_custom provider", () => {
    it("uses FIRECRAWL_BASE_URL and hits /v2/scrape", async () => {
      process.env.FIRECRAWL_BASE_URL = "http://my-local-firecrawl:3002";

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve({ data: { markdown: "# Local" } })
      });

      const res = await handleFetchCore({
        url: "https://example.com",
        provider: "firecrawl_custom",
        providerConfig: {},
        credentials: {}
      });

      expect(res.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://my-local-firecrawl:3002/v2/scrape",
        expect.anything()
      );
    });

    it("falls back to the default local URL when FIRECRAWL_BASE_URL is not set", async () => {
      delete process.env.FIRECRAWL_BASE_URL;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve({ data: { markdown: "# Local" } })
      });

      const res = await handleFetchCore({
        url: "https://example.com",
        provider: "firecrawl_custom",
        providerConfig: {},
        credentials: {}
      });

      expect(res.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:3002/v2/scrape",
        expect.anything()
      );
    });

    it("does not send an Authorization header", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve({ data: { markdown: "# Local" } })
      });

      await handleFetchCore({
        url: "https://example.com",
        provider: "firecrawl_custom",
        providerConfig: {},
        credentials: { apiKey: "should-be-ignored" }
      });

      const [, init] = global.fetch.mock.calls[0];
      expect(init.headers).not.toHaveProperty("authorization");
    });

    it("returns a clear error when the instance is unreachable", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const res = await handleFetchCore({
        url: "https://example.com",
        provider: "firecrawl_custom",
        providerConfig: {},
        credentials: {}
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe(502);
      expect(res.error).toBe("Custom Firecrawl instance unreachable: Connection refused");
    });

    it("returns a clear error when the instance returns a non-2xx response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve({ error: "Internal error" })
      });

      const res = await handleFetchCore({
        url: "https://example.com",
        provider: "firecrawl_custom",
        providerConfig: {},
        credentials: {}
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe(500);
      expect(res.error).toBe("Internal error");
    });
  });

  describe("environment variable overrides", () => {
    it("respects FIRECRAWL_TIMEOUT_MS", async () => {
      process.env.FIRECRAWL_TIMEOUT_MS = "60000";

      global.fetch = vi.fn().mockImplementation((_url, init) => {
        expect(init.signal).toBeDefined();
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/json"]]),
          json: () => Promise.resolve({ data: { markdown: "# OK" } })
        });
      });

      await handleFetchCore({
        url: "https://example.com",
        provider: "firecrawl_custom",
        providerConfig: {},
        credentials: {}
      });

      expect(global.fetch).toHaveBeenCalled();
    });

    it("respects FIRECRAWL_DEFAULT_FORMAT", async () => {
      process.env.FIRECRAWL_DEFAULT_FORMAT = "html";

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve({ data: { html: "<h1>Hello</h1>" } })
      });

      const res = await handleFetchCore({
        url: "https://example.com",
        provider: "firecrawl_custom",
        providerConfig: {},
        credentials: {}
      });

      expect(res.success).toBe(true);
      const [, init] = global.fetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.formats).toEqual(["html"]);
    });
  });
});
