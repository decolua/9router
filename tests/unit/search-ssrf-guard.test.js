import http from "node:http";
import { describe, it, expect } from "vitest";
import { resolveBaseUrl } from "../../open-sse/handlers/search/callers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";

const CONFIG = { id: "searxng", baseUrl: "https://searxng.example.com" };

describe("resolveBaseUrl SSRF guard", () => {
  it("uses provider default when no override", () => {
    expect(resolveBaseUrl(CONFIG, {})).toBe("https://searxng.example.com");
  });

  it("allows public https override", () => {
    const params = { providerOptions: { baseUrl: "https://my-searxng.example.com" } };
    expect(resolveBaseUrl(CONFIG, params)).toBe("https://my-searxng.example.com");
  });

  it("allows public http override", () => {
    const params = { providerOptions: { baseUrl: "http://searxng.example.net" } };
    expect(resolveBaseUrl(CONFIG, params)).toBe("http://searxng.example.net");
  });

  it("rejects loopback override", () => {
    const params = { providerOptions: { baseUrl: "http://127.0.0.1:18999" } };
    expect(() => resolveBaseUrl(CONFIG, params)).toThrow();
  });

  it("rejects private IP override", () => {
    for (const ip of ["10.0.0.1", "192.168.1.1", "172.16.0.1"]) {
      const params = { providerOptions: { baseUrl: `http://${ip}` } };
      expect(() => resolveBaseUrl(CONFIG, params), `should reject ${ip}`).toThrow();
    }
  });

  it("rejects localhost hostname override", () => {
    const params = { providerOptions: { baseUrl: "http://localhost:8080" } };
    expect(() => resolveBaseUrl(CONFIG, params)).toThrow();
  });

  it("rejects cloud metadata override", () => {
    const params = { providerOptions: { baseUrl: "http://169.254.169.254/latest/meta-data" } };
    expect(() => resolveBaseUrl(CONFIG, params)).toThrow();
  });

  it("rejects non-http protocols", () => {
    for (const proto of ["file:///etc/passwd", "gopher://127.0.0.1:70", "ftp://10.0.0.1"]) {
      const params = { providerOptions: { baseUrl: proto } };
      expect(() => resolveBaseUrl(CONFIG, params), `should reject ${proto}`).toThrow();
    }
  });
});

describe("search endpoint trust boundary", () => {
  it("allows an admin-configured SearXNG endpoint on the private network", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        results: [{ title: "Internal result", url: "https://example.com", content: "ok" }],
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      const result = await handleSearchCore({
        body: { query: "test" },
        provider: { id: "searxng" },
        providerConfig: { authType: "none", baseUrl: `http://127.0.0.1:${address.port}` },
        credentials: null,
      });

      expect(result.success, result.error).toBe(true);
      expect(result.data.results[0]).toEqual(expect.objectContaining({
        title: "Internal result",
        url: "https://example.com",
      }));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("still rejects a client-supplied private baseUrl override", async () => {
    const result = await handleSearchCore({
      body: {
        query: "test",
        provider_options: { baseUrl: "http://127.0.0.1:18999" },
      },
      provider: { id: "searxng" },
      providerConfig: { authType: "none", baseUrl: "https://searxng.example.com" },
      credentials: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Blocked URL/);
  });
});
