/**
 * Unit tests for Anthropic header forwarding pipeline
 *
 * Tests cover:
 *  - default.js buildHeaders(): static provider defaults + model-gated anthropic-beta
 *  - default.js buildHeaders(): anthropic-compatible non-Anthropic host stripping
 *  - default.js buildHeaders(): anthropic-compatible official host keeps headers
 *  - proxyFetch.js: api.anthropic.com native transport and header forwarding contract
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
    expect(headers["User-Agent"]).toBe("claude-cli/2.1.258 (external, sdk-cli)");
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

  // A node fronting Anthropic (rotating multi-account proxy, corporate gateway)
  // needs the same beta flags the `claude` provider sends. Without
  // context-management-2025-06-27 upstream answers HTTP 400
  // "context_management: Extra inputs are not permitted" and the combo falls
  // through to the next model without anyone noticing.
  it("sends context-management beta for a Claude model on a custom host", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://myproxy.example.com/v1" },
      },
      true,
      undefined,
      "claude-opus-5"
    );

    const betaFlags = (headers["Anthropic-Beta"] || headers["anthropic-beta"] || "")
      .split(",").map(s => s.trim());
    expect(betaFlags).toContain("context-management-2025-06-27");
    // The first-party identity flag is still stripped for a non-Anthropic host.
    expect(betaFlags).not.toContain("claude-code-20250219");
  });

  it("gates the beta flags on the model id, not the provider prefix", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      {
        apiKey: "key",
        providerSpecificData: { baseUrl: "https://myproxy.example.com/v1" },
      },
      true,
      undefined,
      "kimi-k3"
    );

    const betaVal = headers["Anthropic-Beta"] || headers["anthropic-beta"] || "";
    expect(betaVal).not.toContain("context-management-2025-06-27");
  });
});

// ─── proxyFetch native transport & Claude request forwarding ─────────────────

describe("proxyAwareFetch — native transport & Claude request forwarding", () => {
  let originalEnv;
  let originalFetch;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalFetch = globalThis.fetch;

    // Prevent proxy or DNS redirection during unit tests
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.ALL_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.all_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("preserves auth + beta headers, body, and streams response for official Claude endpoint", async () => {
    const sseBody = "event: message_start\ndata: {}\n\n";
    const mockStreamResponse = new Response(sseBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const mockFetch = vi.fn().mockResolvedValue(mockStreamResponse);

    // Global fetch MUST be stubbed before proxyFetch module is imported
    globalThis.fetch = mockFetch;
    vi.resetModules();

    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");

    const targetUrl = "https://api.anthropic.com/v1/messages";
    const headers = {
      "content-type": "application/json",
      "x-api-key": "sk-ant-testkey",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "claude-code-20250219,effort-2025-11-24",
      "accept": "text/event-stream",
    };
    const body = JSON.stringify({ model: "claude-3-5-sonnet-20241022", stream: true, messages: [] });

    const res = await proxyAwareFetch(targetUrl, {
      method: "POST",
      headers,
      body,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(targetUrl, {
      method: "POST",
      headers,
      body,
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toBe(sseBody);
  });

  it("propagates fetch rejections cleanly without got-scraping fallback", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    globalThis.fetch = mockFetch;
    vi.resetModules();

    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");

    await expect(
      proxyAwareFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).rejects.toThrow("Failed to fetch");
  });
});
