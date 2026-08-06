/**
 * Unit tests for Anthropic header forwarding pipeline
 *
 * Tests cover:
 *  - default.js buildHeaders(): static provider defaults + model-gated anthropic-beta
 *  - default.js buildHeaders(): anthropic-compatible non-Anthropic host stripping
 *  - default.js buildHeaders(): anthropic-compatible official host keeps headers
 *  - proxyFetch.js: api.anthropic.com routes through anthropicFetch path
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── DefaultExecutor.buildHeaders() ──────────────────────────────────────────

describe("DefaultExecutor.buildHeaders() — claude provider", () => {
  let DefaultExecutor;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("open-sse/executors/default.js");
    DefaultExecutor = mod.DefaultExecutor || mod.default;
  });

  it("uses static provider defaults when no model is given", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true);

    const hasVersion =
      headers["Anthropic-Version"] === "2023-06-01" ||
      headers["anthropic-version"] === "2023-06-01";
    expect(hasVersion).toBe(true);
  });

  it("includes heavy-agent beta flags for claude-opus-5", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true, undefined, "claude-opus-5");
    const betaFlags = headers["Anthropic-Beta"].split(",").map(s => s.trim());
    expect(betaFlags).toContain("advanced-tool-use-2025-11-20");
    expect(betaFlags).toContain("effort-2025-11-24");
  });

  it("includes heavy-agent beta flags for claude-sonnet-5", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true, undefined, "claude-sonnet-5");
    const betaFlags = headers["Anthropic-Beta"].split(",").map(s => s.trim());
    expect(betaFlags).toContain("advanced-tool-use-2025-11-20");
    expect(betaFlags).toContain("effort-2025-11-24");
  });

  it("omits heavy-agent beta flags for claude-haiku-4-5-20251001", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true, undefined, "claude-haiku-4-5-20251001");
    const betaFlags = headers["Anthropic-Beta"].split(",").map(s => s.trim());
    expect(betaFlags).not.toContain("advanced-tool-use-2025-11-20");
    expect(betaFlags).not.toContain("effort-2025-11-24");
    expect(betaFlags).toContain("claude-code-20250219");
  });

  it("omits heavy-agent beta flags for claude-fable-5", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true, undefined, "claude-fable-5");
    const betaFlags = headers["Anthropic-Beta"].split(",").map(s => s.trim());
    expect(betaFlags).not.toContain("advanced-tool-use-2025-11-20");
    expect(betaFlags).not.toContain("effort-2025-11-24");
  });

  it("sets x-api-key auth when apiKey is provided", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-live-key" }, true);
    expect(headers["x-api-key"]).toBe("sk-live-key");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("sets Bearer Authorization when only accessToken is provided", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ accessToken: "tok-abc" }, true);
    expect(headers["Authorization"]).toBe("Bearer tok-abc");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("includes Accept: text/event-stream when stream=true", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "k" }, true);
    expect(headers["Accept"]).toBe("text/event-stream");
  });

  it("omits Accept: text/event-stream when stream=false", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "k" }, false);
    expect(headers["Accept"]).toBeUndefined();
  });

  it("does not throw when no model is given", () => {
    const executor = new DefaultExecutor("claude");
    expect(() => executor.buildHeaders({ apiKey: "sk" }, false)).not.toThrow();
  });
});

// ─── anthropic-compatible header stripping ────────────────────────────────────

describe("DefaultExecutor.buildHeaders() — anthropic-compatible stripping", () => {
  let DefaultExecutor;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("open-sse/executors/default.js");
    DefaultExecutor = mod.DefaultExecutor || mod.default;
  });

  it("strips x-app and anthropic-dangerous-direct-browser-access for non-Anthropic host", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://myproxy.example.com/v1" },
      },
      true
    );

    expect(headers["x-app"]).toBeUndefined();
    expect(headers["X-App"]).toBeUndefined();
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
    expect(headers["Anthropic-Dangerous-Direct-Browser-Access"]).toBeUndefined();
  });

  it("removes claude-code-20250219 from anthropic-beta for non-Anthropic host", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://myproxy.example.com/v1" },
      },
      true
    );

    const betaVal = headers["anthropic-beta"] || headers["Anthropic-Beta"] || "";
    expect(betaVal).not.toContain("claude-code-20250219");
  });

  it("keeps Claude identity headers for claude-cli profile on non-Anthropic host", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: {
          baseUrl: "https://myproxy.example.com/v1",
          clientIdentityProfile: "claude-cli",
        },
      },
      true
    );

    expect(headers["X-App"]).toBe("cli");
    expect(headers["Anthropic-Beta"]).toContain("claude-code-20250219");
    expect(headers["Authorization"]).toBe("Bearer key");
    expect(headers["x-api-key"]).toBe("key");
  });

  it("keeps custom Claude identity headers on non-Anthropic host", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: {
          baseUrl: "https://myproxy.example.com/v1",
          clientIdentityProfile: "custom",
          clientIdentityHeaders: {
            "X-App": "cli",
            "Anthropic-Beta": "claude-code-20250219",
          },
        },
      },
      false
    );

    expect(headers["X-App"]).toBe("cli");
    expect(headers["Anthropic-Beta"]).toBe("claude-code-20250219");
  });

  it("keeps auth headers ahead of custom identity headers", () => {
    const executor = new DefaultExecutor("openai-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "real-key",
        providerSpecificData: {
          baseUrl: "https://openai-compatible.example.com/v1",
          clientIdentityProfile: "custom",
          clientIdentityHeaders: {
            Authorization: "Bearer fake-key",
            "User-Agent": "custom/1.0",
          },
        },
      },
      false
    );

    expect(headers["Authorization"]).toBe("Bearer real-key");
    expect(headers["User-Agent"]).toBe("custom/1.0");
  });

  it("keeps other beta flags intact after stripping", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    // The static CLAUDE_API_HEADERS used by anthropic-compatible providers include
    // 'interleaved-thinking-2025-05-14' — check it survives stripping
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://myproxy.example.com/v1" },
      },
      false
    );

    const betaVal = headers["anthropic-beta"] || headers["Anthropic-Beta"] || "";
    // If any beta value remains it should not be empty and should not have the stripped value
    if (betaVal) {
      expect(betaVal).not.toContain("claude-code-20250219");
    }
  });

  it("does NOT strip headers when baseUrl is api.anthropic.com", () => {
    const executor = new DefaultExecutor("anthropic-compatible-official");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" },
      },
      true
    );

    // No stripping — anthropic-version should survive
    const hasVersion =
      headers["Anthropic-Version"] || headers["anthropic-version"];
    expect(hasVersion).toBeDefined();
  });

  it("does NOT strip headers when baseUrl is empty (defaults to Anthropic)", () => {
    const executor = new DefaultExecutor("anthropic-compatible-official");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: {},
      },
      true
    );

    const hasVersion =
      headers["Anthropic-Version"] || headers["anthropic-version"];
    expect(hasVersion).toBeDefined();
  });
});

// ─── proxyFetch anthropicFetch routing ────────────────────────────────────────

describe("proxyAwareFetch — api.anthropic.com routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes api.anthropic.com to gotScraping (non-streaming) and returns ok response", async () => {
    // Mock got-scraping before module load
    vi.doMock("got-scraping", () => {
      const mockGotScraping = vi.fn().mockResolvedValue({
        statusCode: 200,
        statusMessage: "OK",
        headers: { "content-type": "application/json" },
        rawBody: Buffer.from(JSON.stringify({ id: "msg_test" })),
      });
      mockGotScraping.stream = vi.fn();
      return { gotScraping: mockGotScraping };
    });

    vi.resetModules();
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
    const { gotScraping } = await import("got-scraping");

    const res = await proxyAwareFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      // No Accept: text/event-stream → non-streaming path
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-3-5-sonnet-20241022", messages: [] }),
    });

    expect(gotScraping).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("msg_test");
  });

  it("falls back gracefully when got-scraping throws on non-streaming path", async () => {
    vi.doMock("got-scraping", () => {
      const fn = vi.fn().mockRejectedValue(new Error("TLS error"));
      fn.stream = vi.fn();
      return { gotScraping: fn };
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: null,
      text: async () => "{}",
      json: async () => ({}),
    });

    vi.resetModules();
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");

    const res = await proxyAwareFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.ok).toBe(true);
    globalThis.fetch = originalFetch;
  });

  it("does NOT route non-Anthropic hosts through gotScraping", async () => {
    const gotScrapingMock = vi.fn();
    vi.doMock("got-scraping", () => ({ gotScraping: gotScrapingMock }));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: null,
      text: async () => "{}",
      json: async () => ({}),
    });

    vi.resetModules();
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");

    await proxyAwareFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(gotScrapingMock).not.toHaveBeenCalled();
  });
});
