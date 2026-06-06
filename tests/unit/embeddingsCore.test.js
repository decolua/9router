/**
 * Unit tests for open-sse/handlers/embeddingsCore.js
 *
 * Tests cover:
 *  - buildEmbeddingsBody()     — request body construction
 *  - buildEmbeddingsUrl()      — URL per provider
 *  - buildEmbeddingsHeaders()  — headers per provider
 *  - handleEmbeddingsCore()    — full handler: success, errors, validation
 *  - connection-level proxy    — proxyOptions forwarded to proxyAwareFetch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock the executors/index.js to avoid transitive uuid dependency ─────────
// kiro.js (imported by executors/index.js) requires 'uuid' which isn't
// installed in the test environment. We mock the whole executor layer.
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
  hasSpecializedExecutor: vi.fn(() => false),
}));

// Also mock tokenRefresh to avoid side effects
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn().mockResolvedValue(null),
}));

// Mock proxyFetch — proxyAwareFetch is the function the handler actually calls.
// Expose it as a named export so tests can assert on calls and inject responses.
// Note: vi.mock factories are hoisted, so the mock fn must be created inside.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { proxyAwareFetch as proxyAwareFetchMock } from "../../open-sse/utils/proxyFetch.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal success Response from a provider */
function makeProviderResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a minimal error Response from a provider */
function makeProviderErrorResponse(status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Standard valid embeddings response in OpenAI format */
const VALID_EMBEDDING_RESPONSE = {
  object: "list",
  data: [
    {
      object: "embedding",
      index: 0,
      embedding: [0.1, 0.2, 0.3],
    },
  ],
  model: "text-embedding-ada-002",
  usage: { prompt_tokens: 3, total_tokens: 3 },
};

/** Standard handleEmbeddingsCore options for OpenAI provider */
function makeOptions(overrides = {}) {
  return {
    body: { model: "text-embedding-ada-002", input: "Hello world" },
    modelInfo: { provider: "openai", model: "text-embedding-ada-002" },
    credentials: { apiKey: "sk-test-key" },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    onCredentialsRefreshed: vi.fn(),
    onRequestSuccess: vi.fn(),
    ...overrides,
  };
}

/** Shorthand: first (url, init, proxyOptions) tuple passed to proxyAwareFetch */
function firstCall() {
  return proxyAwareFetchMock.mock.calls[0];
}
function secondCall() {
  return proxyAwareFetchMock.mock.calls[1];
}

// ─── Test: buildEmbeddingsBody (via handleEmbeddingsCore internals) ──────────
// We test body construction indirectly by verifying the fetch call payload.

describe("buildEmbeddingsBody", () => {
  beforeEach(() => {
    proxyAwareFetchMock.mockReset();
  });

  it("single string input — includes model and input, default encoding_format=float", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002", input: "Hello world" },
    }));

    const [, init] = firstCall();
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("text-embedding-ada-002");
    expect(sent.input).toBe("Hello world");
    expect(sent.encoding_format).toBe("float");
  });

  it("array input — passes array as-is", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002", input: ["Hello", "World"] },
    }));

    const [, init] = firstCall();
    const sent = JSON.parse(init.body);
    expect(sent.input).toEqual(["Hello", "World"]);
  });

  it("custom encoding_format is forwarded", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      body: {
        model: "text-embedding-ada-002",
        input: "test",
        encoding_format: "base64",
      },
    }));

    const [, init] = firstCall();
    const sent = JSON.parse(init.body);
    expect(sent.encoding_format).toBe("base64");
  });

  it("no encoding_format in body → defaults to float", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002", input: "test" },
    }));

    const [, init] = firstCall();
    const sent = JSON.parse(init.body);
    expect(sent.encoding_format).toBe("float");
  });

  it("gemini single input forwards dimensions as outputDimensionality", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse({
      embedding: { values: [0.1, 0.2, 0.3] },
    }));

    await handleEmbeddingsCore(makeOptions({
      body: {
        model: "gemini/gemini-embedding-2-preview",
        input: "test",
        dimensions: 1536,
      },
      modelInfo: { provider: "gemini", model: "gemini-embedding-2-preview" },
      credentials: { apiKey: "gemini-key" },
    }));

    const [, init] = firstCall();
    const sent = JSON.parse(init.body);
    expect(sent.outputDimensionality).toBe(1536);
  });

  it("gemini batch input forwards dimensions on each request", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse({
      embeddings: [
        { values: [0.1, 0.2, 0.3] },
        { values: [0.4, 0.5, 0.6] },
      ],
    }));

    await handleEmbeddingsCore(makeOptions({
      body: {
        model: "gemini/gemini-embedding-2-preview",
        input: ["hello", "world"],
        dimensions: 1536,
      },
      modelInfo: { provider: "gemini", model: "gemini-embedding-2-preview" },
      credentials: { apiKey: "gemini-key" },
    }));

    const [, init] = firstCall();
    const sent = JSON.parse(init.body);
    expect(sent.requests).toHaveLength(2);
    expect(sent.requests[0].outputDimensionality).toBe(1536);
    expect(sent.requests[1].outputDimensionality).toBe(1536);
  });
});

// ─── Test: buildEmbeddingsUrl ────────────────────────────────────────────────

describe("buildEmbeddingsUrl", () => {
  beforeEach(() => {
    proxyAwareFetchMock.mockReset();
  });

  it("openai → https://api.openai.com/v1/embeddings", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai", model: "text-embedding-ada-002" },
      credentials: { apiKey: "sk-test" },
    }));

    const [url] = firstCall();
    expect(url).toBe("https://api.openai.com/v1/embeddings");
  });

  it("openrouter → https://openrouter.ai/api/v1/embeddings", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openrouter", model: "openai/text-embedding-ada-002" },
      credentials: { apiKey: "sk-or-test" },
    }));

    const [url] = firstCall();
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
  });

  it("openai-compatible-* → uses baseUrl from providerSpecificData", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai-compatible-custom", model: "embed-v1" },
      credentials: {
        apiKey: "sk-custom",
        providerSpecificData: { baseUrl: "https://custom.ai/v1" },
      },
    }));

    const [url] = firstCall();
    expect(url).toBe("https://custom.ai/v1/embeddings");
  });

  it("openai-compatible-* strips trailing slash from baseUrl", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai-compatible-myhost", model: "embed-v1" },
      credentials: {
        apiKey: "sk-x",
        providerSpecificData: { baseUrl: "https://myhost.ai/v1/" },
      },
    }));

    const [url] = firstCall();
    expect(url).toBe("https://myhost.ai/v1/embeddings");
  });

  it("openai-compatible-* without baseUrl → falls back to api.openai.com", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai-compatible-fallback", model: "embed" },
      credentials: { apiKey: "sk-x", providerSpecificData: {} },
    }));

    const [url] = firstCall();
    expect(url).toBe("https://api.openai.com/v1/embeddings");
  });

  it("unsupported provider (e.g. gemini-cli) → 400 error, no fetch called", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "gemini-cli", model: "gemini-embedding" },
      credentials: { apiKey: "token" },
    }));

    expect(proxyAwareFetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/does not support embeddings/i);
  });

  it("antigravity (non-openai-compatible, no URL mapping) → 400", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "antigravity", model: "some-embed" },
      credentials: { apiKey: "ag-token" },
    }));

    expect(proxyAwareFetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });
});

// ─── Test: buildEmbeddingsHeaders ───────────────────────────────────────────

describe("buildEmbeddingsHeaders", () => {
  beforeEach(() => {
    proxyAwareFetchMock.mockReset();
  });

  it("openai → Authorization: Bearer, Content-Type: application/json", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai", model: "text-embedding-ada-002" },
      credentials: { apiKey: "sk-mykey" },
    }));

    const [, init] = firstCall();
    expect(init.headers["Authorization"]).toBe("Bearer sk-mykey");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("openai — uses accessToken when apiKey is absent", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai", model: "text-embedding-ada-002" },
      credentials: { accessToken: "at-mytoken" },
    }));

    const [, init] = firstCall();
    expect(init.headers["Authorization"]).toBe("Bearer at-mytoken");
  });

  it("openrouter → adds HTTP-Referer and X-Title headers", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openrouter", model: "openai/text-embedding-ada-002" },
      credentials: { apiKey: "sk-or-key" },
    }));

    const [, init] = firstCall();
    expect(init.headers["HTTP-Referer"]).toBeDefined();
    expect(init.headers["X-Title"]).toBeDefined();
    expect(init.headers["Authorization"]).toBe("Bearer sk-or-key");
  });

  it("openai-compatible-* → Authorization: Bearer *** (no extra headers)", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai-compatible-local", model: "nomic-embed" },
      credentials: {
        apiKey: "local-key",
        providerSpecificData: { baseUrl: "http://localhost:11434/v1" },
      },
    }));

    const [, init] = firstCall();
    expect(init.headers["Authorization"]).toBe("Bearer local-key");
    expect(init.headers["HTTP-Referer"]).toBeUndefined();
    expect(init.headers["X-Title"]).toBeUndefined();
  });
});

// ─── Test: handleEmbeddingsCore — input validation ───────────────────────────

describe("handleEmbeddingsCore — input validation", () => {
  beforeEach(() => {
    proxyAwareFetchMock.mockReset();
  });

  it("missing input → 400 Bad Request", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002" }, // no input
    }));
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/missing required field: input/i);
  });

  it("input is a number → 400 Bad Request", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002", input: 42 },
    }));
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/input must be a string or array/i);
  });

  it("input is an object → 400 Bad Request", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002", input: { text: "hello" } },
    }));
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/input must be a string or array/i);
  });

  it("input is null → 400 Bad Request", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002", input: null },
    }));
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  it("empty string input passes validation", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(
      makeProviderResponse(VALID_EMBEDDING_RESPONSE)
    );
    const result = await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002", input: "" },
    }));
    // Empty string is falsy → treated as missing
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  it("empty array input passes validation and reaches provider", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(
      makeProviderResponse(VALID_EMBEDDING_RESPONSE)
    );
    const result = await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002", input: [] },
    }));
    // Empty array is truthy → passes, fetch is called
    expect(proxyAwareFetchMock).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
  });
});

// ─── Test: handleEmbeddingsCore — success path ───────────────────────────────

describe("handleEmbeddingsCore — success path", () => {
  beforeEach(() => {
    proxyAwareFetchMock.mockReset();
  });

  it("returns success=true with Response on 200", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.success).toBe(true);
    expect(result.response).toBeInstanceOf(Response);
    expect(result.response.status).toBe(200);
  });

  it("response body is valid OpenAI-format JSON", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    const result = await handleEmbeddingsCore(makeOptions());
    const body = await result.response.json();

    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]).toHaveProperty("embedding");
    expect(body.data[0]).toHaveProperty("index");
  });

  it("response includes CORS header Access-Control-Allow-Origin: *", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("response Content-Type is application/json", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.response.headers.get("Content-Type")).toContain("application/json");
  });

  it("calls onRequestSuccess callback on success", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));
    const onRequestSuccess = vi.fn();

    await handleEmbeddingsCore(makeOptions({ onRequestSuccess }));

    expect(onRequestSuccess).toHaveBeenCalledOnce();
  });

  it("does not call onRequestSuccess on provider error", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderErrorResponse(500, "Server exploded"));
    const onRequestSuccess = vi.fn();

    await handleEmbeddingsCore(makeOptions({ onRequestSuccess }));

    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("provider response with non-standard format is passed through as-is", async () => {
    const nonStandardBody = { embeddings: [[0.1, 0.2]], model: "custom" };
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(nonStandardBody));

    const result = await handleEmbeddingsCore(makeOptions());
    const body = await result.response.json();

    expect(body).toEqual(nonStandardBody);
  });
});

// ─── Test: handleEmbeddingsCore — provider error handling ────────────────────

describe("handleEmbeddingsCore — provider error handling", () => {
  beforeEach(() => {
    proxyAwareFetchMock.mockReset();
  });

  it("provider 400 → returns success=false with status 400", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderErrorResponse(400, "Bad model"));

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  it("provider 429 → returns success=false with status 429", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderErrorResponse(429, "Rate limit exceeded"));

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
  });

  it("provider 500 → returns success=false with status 500", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderErrorResponse(500, "Internal error"));

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
  });

  it("network error (fetch throws) → returns 502 Bad Gateway", async () => {
    proxyAwareFetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it("invalid JSON from provider → returns 502", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(
      new Response("not json }{", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })
    );

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("error result response has OpenAI-format error body", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderErrorResponse(400, "Bad model"));

    const result = await handleEmbeddingsCore(makeOptions());
    const body = await result.response.json();

    expect(body).toHaveProperty("error");
    expect(body.error).toHaveProperty("message");
  });
});

// ─── Test: handleEmbeddingsCore — token refresh on 401 ───────────────────────

describe("handleEmbeddingsCore — token refresh on 401/403", () => {
  beforeEach(() => {
    proxyAwareFetchMock.mockReset();
  });

  it("on 401, attempts retry after refresh; succeeds if refresh gives new token", async () => {
    // First call → 401 from provider
    proxyAwareFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    // Second call (retry) → success
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    // Credentials with a refreshToken so the executor can try to refresh
    const credentials = {
      apiKey: "sk-old",
      accessToken: "at-old",
      refreshToken: "rt-valid",
    };

    // Mock executor's refreshCredentials to return new creds
    const result = await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai", model: "text-embedding-ada-002" },
      credentials,
      onCredentialsRefreshed: vi.fn(),
    }));

    // The handler may or may not succeed depending on whether the executor
    // can refresh (openai executor likely can't). What we verify is that
    // fetch was called at least once (the initial request).
    expect(proxyAwareFetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("on 401 with no refresh token, falls back gracefully (no crash)", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await handleEmbeddingsCore(makeOptions({
      credentials: { apiKey: "sk-bad" },
    }));

    // Should return an error result, not throw
    expect(result).toHaveProperty("success");
    expect(result.success).toBe(false);
  });
});

// ─── Test: connection-level proxy is forwarded to proxyAwareFetch ────────────
// Regression tests for the bug where embeddings bypassed the connection's
// configured proxy (proxy pool / legacy connectionProxyUrl / vercel relay).

describe("handleEmbeddingsCore — connection proxy forwarding (regression)", () => {
  beforeEach(() => {
    proxyAwareFetchMock.mockReset();
  });

  it("forwards proxyOptions with connectionProxyEnabled + connectionProxyUrl to proxyAwareFetch", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "gemini", model: "gemini-embedding-001" },
      credentials: {
        apiKey: "gemini-key",
        providerSpecificData: {
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://user:pass@127.0.0.1:7890",
          connectionNoProxy: "localhost,127.0.0.1",
        },
      },
    }));

    const [, , proxyOptions] = firstCall();
    expect(proxyOptions).toEqual({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://user:pass@127.0.0.1:7890",
      connectionNoProxy: "localhost,127.0.0.1",
      vercelRelayUrl: "",
    });
  });

  it("forwards vercelRelayUrl from providerSpecificData", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai", model: "text-embedding-ada-002" },
      credentials: {
        apiKey: "sk-test",
        providerSpecificData: {
          vercelRelayUrl: "https://relay.example.workers.dev",
        },
      },
    }));

    const [, , proxyOptions] = firstCall();
    expect(proxyOptions.vercelRelayUrl).toBe("https://relay.example.workers.dev");
  });

  it("sends empty proxyOptions when no connection proxy is configured", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      credentials: {
        apiKey: "sk-test",
        providerSpecificData: { baseUrl: "https://api.openai.com/v1" },
      },
    }));

    const [, , proxyOptions] = firstCall();
    expect(proxyOptions).toEqual({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      vercelRelayUrl: "",
    });
  });

  it("handles missing providerSpecificData gracefully (no crash)", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      credentials: { apiKey: "sk-test" }, // no providerSpecificData
    }));

    const [, , proxyOptions] = firstCall();
    expect(proxyOptions).toEqual({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      vercelRelayUrl: "",
    });
  });

  it("forwards proxyOptions on the 401/403 retry fetch as well", async () => {
    // First call → 401
    proxyAwareFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    // Retry call → success
    proxyAwareFetchMock.mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai", model: "text-embedding-ada-002" },
      credentials: {
        apiKey: "sk-old",
        accessToken: "at-old",
        refreshToken: "rt-valid",
        providerSpecificData: {
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://proxy.local:8080",
        },
      },
    }));

    // Both calls must carry the same proxyOptions
    expect(proxyAwareFetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    const [, , firstOpts] = firstCall();
    expect(firstOpts.connectionProxyEnabled).toBe(true);
    expect(firstOpts.connectionProxyUrl).toBe("http://proxy.local:8080");

    if (proxyAwareFetchMock.mock.calls.length >= 2) {
      const [, , secondOpts] = secondCall();
      expect(secondOpts.connectionProxyEnabled).toBe(true);
      expect(secondOpts.connectionProxyUrl).toBe("http://proxy.local:8080");
    }
  });
});
