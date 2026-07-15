import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("transparent Anthropic proxy", () => {
  let originalFetch;

  beforeEach(() => {
    vi.resetModules();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function loadHandler(fetchImpl) {
    globalThis.fetch = vi.fn(fetchImpl);
    return import("open-sse/handlers/transparentProxy.js");
  }

  it("preserves Claude Code identity and unknown headers while replacing credentials", async () => {
    const { handleTransparentAnthropicProxy } = await loadHandler(async () => new Response("ok"));
    const request = new Request("http://router.test/api/v1/messages?beta=1", {
      method: "POST",
      headers: {
        authorization: "Bearer local-router-key",
        "x-app": "cli",
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        "x-claude-code-session-id": "session-1",
        "x-client-trace": "trace-1",
        connection: "keep-alive",
      },
      body: "{\n  \"model\": \"free/claude-fable-5\"\n}",
    });

    await handleTransparentAnthropicProxy({
      request,
      credentials: {
        apiKey: "upstream-key",
        providerSpecificData: { baseUrl: "https://cc.freemodel.dev/v1" },
      },
    });

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(globalThis.fetch.mock.calls[0][0]).toBe("https://cc.freemodel.dev/v1/messages?beta=1");
    expect(options.headers.get("authorization")).toBe("Bearer upstream-key");
    expect(options.headers.get("x-api-key")).toBe("upstream-key");
    expect(options.headers.get("x-app")).toBe("cli");
    expect(options.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(options.headers.get("anthropic-beta")).toContain("claude-code-20250219");
    expect(options.headers.get("x-claude-code-session-id")).toBe("session-1");
    expect(options.headers.get("x-client-trace")).toBe("trace-1");
    expect(options.headers.get("connection")).toBeNull();
  });

  it("forwards the original body stream without JSON serialization", async () => {
    const { handleTransparentAnthropicProxy } = await loadHandler(async () => new Response("ok"));
    const request = new Request("http://router.test/api/v1/messages", {
      method: "POST",
      body: "{\n  \"z\": 1,\n  \"a\": [ 2, 3 ]\n}",
    });
    const originalBody = request.body;

    await handleTransparentAnthropicProxy({
      request,
      credentials: { providerSpecificData: { baseUrl: "https://cc.freemodel.dev/v1" } },
    });

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.body).toBe(originalBody);
    expect(options.duplex).toBe("half");
  });

  it("replaces only the 9Router model prefix when routing requires it", async () => {
    const { handleTransparentAnthropicProxy } = await loadHandler(async () => new Response("ok"));
    const body = "{\n  \"model\": \"free/claude-opus-4-7\",\n  \"max_tokens\": 12\n}";
    const request = new Request("http://router.test/api/v1/messages", { method: "POST", body });

    await handleTransparentAnthropicProxy({
      request,
      sourceModel: "free/claude-opus-4-7",
      upstreamModel: "claude-opus-4-7",
      credentials: { providerSpecificData: { baseUrl: "https://cc.freemodel.dev/v1" } },
    });

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(await new Response(options.body).text()).toBe(
      "{\n  \"model\": \"claude-opus-4-7\",\n  \"max_tokens\": 12\n}"
    );
  });

  it("returns the upstream SSE bytes and headers unchanged", async () => {
    const sse = "event: message_start\ndata: {\"type\":\"message_start\"}\n\nevent: custom_event\ndata: not-json\n\ndata:[DONE]\n\n";
    const { handleTransparentAnthropicProxy } = await loadHandler(async () => new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream", "x-upstream": "exact" },
    }));
    const request = new Request("http://router.test/api/v1/messages", { method: "POST", body: "{}" });

    const response = await handleTransparentAnthropicProxy({
      request,
      credentials: { providerSpecificData: { baseUrl: "https://cc.freemodel.dev/v1" } },
    });

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-upstream")).toBe("exact");
    expect(await response.text()).toBe(sse);
  });
});
