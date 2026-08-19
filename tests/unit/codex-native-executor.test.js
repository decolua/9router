import { beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeCodexNativeRequestHeaders } from "@/lib/codexNative/headers.js";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  acquire: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  release: vi.fn(),
  semantic: vi.fn(),
  quota: vi.fn(),
  invalidate: vi.fn(),
  getCatalog: vi.fn(),
  getInstalledVersion: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
vi.mock("@/lib/codexNative/clientAuth.js", () => ({
  validateCodexNativeClient: vi.fn(async () => ({ ok: true })),
  codexNativeAuthError: vi.fn(),
}));
vi.mock("@/lib/codexNative/catalog.js", () => ({
  getCodexNativeCatalog: (...args) => mocks.getCatalog(...args),
  getMostRecentCodexClientVersion: vi.fn(async () => "0.145.0"),
  isCodexNativeModel: (_catalog, model) => model === "gpt-native",
  invalidateCodexNativeCatalog: (...args) => mocks.invalidate(...args),
}));
vi.mock("@/lib/codexNative/clientVersion.js", () => ({
  getInstalledCodexClientVersion: (...args) => mocks.getInstalledVersion(...args),
}));
vi.mock("@/lib/codexNative/pool.js", () => ({
  acquireCodexNativeLease: (...args) => mocks.acquire(...args),
  failCodexNativeLease: (...args) => mocks.failure(...args),
  ingestCodexNativeQuota: (...args) => mocks.quota(...args),
  incrementCodexNativeHttpFallback: vi.fn(),
  markCodexNativeSemanticOutput: (...args) => mocks.semantic(...args),
  releaseCodexNativeLease: (...args) => mocks.release(...args),
  succeedCodexNativeLease: (...args) => mocks.success(...args),
}));

describe("Codex Native transparent HTTP transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquire.mockResolvedValue({
      lease: {
        id: "lease-1",
        connectionId: "account-1",
        credentials: {
          accessToken: "upstream-token",
          providerSpecificData: { chatgptAccountId: "upstream-account" },
        },
        proxy: {},
      },
    });
    mocks.getCatalog.mockResolvedValue({ models: [{ slug: "gpt-native" }] });
    mocks.getInstalledVersion.mockResolvedValue({
      installed: true,
      version: "0.146.0",
      raw: "codex-cli 0.146.0",
    });
  });

  it("forwards semantic headers but always rebuilds credentials", () => {
    const headers = sanitizeCodexNativeRequestHeaders(new Headers({
      authorization: "Bearer client-key",
      "chatgpt-account-id": "client-account",
      cookie: "secret=1",
      host: "attacker.invalid",
      "x-forwarded-for": "203.0.113.4",
      "session-id": "session-1",
      "thread-id": "thread-1",
      "x-codex-future-protocol": "v3",
      "x-openai-subagent": "collab_spawn",
      "user-agent": "codex/next",
    }), {
      accessToken: "upstream-token",
      providerSpecificData: { chatgptAccountId: "upstream-account" },
    });

    expect(headers.get("authorization")).toBe("Bearer upstream-token");
    expect(headers.get("chatgpt-account-id")).toBe("upstream-account");
    expect(headers.get("session-id")).toBe("session-1");
    expect(headers.get("thread-id")).toBe("thread-1");
    expect(headers.get("x-codex-future-protocol")).toBe("v3");
    expect(headers.get("x-openai-subagent")).toBe("collab_spawn");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("host")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
  });

  it("relays the exact request bytes, unknown fields, SSE bytes, status, and native response headers", async () => {
    const original = '{"model":"gpt-native","input":[],"future_field":{"kept":true},"stream":true}';
    const upstreamSse = "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}\n\n";
    mocks.fetch.mockResolvedValue(new Response(upstreamSse, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-codex-turn-state": "turn-state",
        "x-models-etag": "models-v2",
        "set-cookie": "upstream-secret=1",
      },
    }));
    const { relayCodexNativeHttp } = await import("@/lib/codexNative/relay.js");
    const response = await relayCodexNativeHttp(new Request("http://localhost/v1/codex/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer client-key",
        "session-id": "session-1",
      },
      body: original,
    }), {
      path: "responses",
      operation: "responses",
      validateModel: true,
      allowTransportReplay: true,
    });

    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(new TextDecoder().decode(options.body)).toBe(original);
    expect(options.headers.get("authorization")).toBe("Bearer upstream-token");
    expect(options.headers.get("session-id")).toBe("session-1");
    expect(mocks.getCatalog).toHaveBeenCalledWith({ clientVersion: "0.146.0" });
    expect(mocks.acquire).toHaveBeenCalledWith(expect.objectContaining({
      clientVersion: "0.146.0",
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-codex-turn-state")).toBe("turn-state");
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.text()).resolves.toBe(upstreamSse);
    expect(mocks.semantic).toHaveBeenCalledWith("lease-1");
    expect(mocks.success).toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith("lease-1");
  });

  it("does not replay an ambiguous image-generation transport failure", async () => {
    mocks.fetch.mockRejectedValue(new Error("socket reset"));
    const { relayCodexNativeHttp } = await import("@/lib/codexNative/relay.js");
    const response = await relayCodexNativeHttp(new Request("http://localhost/v1/codex/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"prompt":"draw"}',
    }), {
      path: "images/generations",
      operation: "image-generation",
    });
    expect(response.status).toBe(502);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("releases an aborted Responses request without account failure or transport replay", async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementation(async (_url, options) => {
      controller.abort();
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    const { relayCodexNativeHttp } = await import("@/lib/codexNative/relay.js");
    const response = await relayCodexNativeHttp(new Request("http://localhost/v1/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"model":"gpt-native","input":[]}',
      signal: controller.signal,
    }), {
      path: "responses",
      operation: "responses",
      validateModel: true,
      allowTransportReplay: true,
    });
    expect(response.status).toBe(499);
    expect(mocks.failure).not.toHaveBeenCalled();
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledWith("lease-1");
  });

  it("marks an incomplete HTTP compaction stream as failed instead of successful", async () => {
    mocks.fetch.mockResolvedValue(new Response(
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      { headers: { "content-type": "text/event-stream" } }
    ));
    const { relayCodexNativeHttp } = await import("@/lib/codexNative/relay.js");
    const response = await relayCodexNativeHttp(new Request("http://localhost/v1/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-native",
        input: [],
        client_metadata: {
          "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }),
        },
      }),
    }), {
      path: "responses",
      operation: "responses",
      validateModel: true,
      allowTransportReplay: true,
    });
    await response.text();
    expect(mocks.failure).toHaveBeenCalledWith("lease-1", expect.objectContaining({ status: 502 }));
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith("lease-1");
  });

  it("accepts a large CRLF-delimited compaction terminal event split across chunks", async () => {
    const encoder = new TextEncoder();
    const terminal = `data: ${JSON.stringify({
      type: "response.completed",
      response: { status: "completed", padding: "x".repeat(32_768) },
    })}\r\n\r\n`;
    mocks.fetch.mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < terminal.length; offset += 4096) {
          controller.enqueue(encoder.encode(terminal.slice(offset, offset + 4096)));
        }
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } }));
    const { relayCodexNativeHttp } = await import("@/lib/codexNative/relay.js");
    const response = await relayCodexNativeHttp(new Request("http://localhost/v1/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-native",
        input: [],
        client_metadata: {
          "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }),
        },
      }),
    }), {
      path: "responses",
      operation: "responses",
      validateModel: true,
      allowTransportReplay: true,
    });
    await response.text();
    expect(mocks.success).toHaveBeenCalledWith("lease-1", expect.any(Object));
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it("does not replay a failed HTTP compaction through another account", async () => {
    mocks.fetch.mockRejectedValue(new Error("socket reset"));
    const { relayCodexNativeHttp } = await import("@/lib/codexNative/relay.js");
    const response = await relayCodexNativeHttp(new Request("http://localhost/v1/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-native",
        input: [],
        client_metadata: {
          "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }),
        },
      }),
    }), {
      path: "responses",
      operation: "responses",
      validateModel: true,
      allowTransportReplay: true,
    });
    expect(response.status).toBe(502);
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful HTTP compaction response without a body", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    const { relayCodexNativeHttp } = await import("@/lib/codexNative/relay.js");
    const response = await relayCodexNativeHttp(new Request("http://localhost/v1/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-native",
        input: [],
        client_metadata: {
          "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }),
        },
      }),
    }), {
      path: "responses",
      operation: "responses",
      validateModel: true,
      allowTransportReplay: true,
    });
    expect(response.status).toBe(502);
    expect(mocks.failure).toHaveBeenCalledWith("lease-1", expect.objectContaining({ status: 502 }));
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
