/**
 * Task 11 RED: root final-owner wiring across the proxy handlers.
 *
 * These tests exercise the exported app handlers directly. They are expected to
 * FAIL until `src/sse/handlers/*.js` wraps each entry in
 * `runWithWebhookContext`, marks admission after parse+auth+local validation,
 * and forwards the task10 `onStreamTerminal` observer plus `request.signal`.
 *
 * Locked wiring contract (documented here for GREEN):
 *   - Every exported handler is its own root for a direct call.
 *   - Admission happens exactly once, before provider resolution.
 *   - Only the root finalizes `request.failed`; nested/combo/fusion members reuse
 *     the same root and never finalize on their own.
 *   - A 2xx response is not a final success: streaming failures are observed by
 *     the source terminal callback before the root finalizes.
 *   - Errors before admission (bad JSON, auth failure, missing local fields) emit
 *     zero events.
 *   - Observer wiring never changes status, headers or body.
 *   - No sink installed means no enqueue surface and no behavior change.
 *
 * The webhook sink is the real events.js DI seam; upstream/DB dependencies are
 * mocked. Nothing here performs network, DB or stream I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fx = vi.hoisted(() => {
  const state = {
    settings: { requireApiKey: false, comboStrategy: "fallback" },
    combos: {},
    models: {},
    auth: {
      getProviderCredentials: vi.fn(),
      markAccountUnavailable: vi.fn(),
      clearAccountError: vi.fn(async () => {}),
      extractApiKey: vi.fn(() => null),
      isValidApiKey: vi.fn(async () => true),
    },
    core: {
      handleChatCore: vi.fn(),
      handleEmbeddingsCore: vi.fn(),
      handleSearchCore: vi.fn(),
      handleFetchCore: vi.fn(),
      handleImageGenerationCore: vi.fn(),
      handleTtsCore: vi.fn(),
      handleSttCore: vi.fn(),
      handleSystemoneCore: vi.fn(),
      handleVideoProxyCore: vi.fn(),
    },
    combo: {
      handleComboChat: vi.fn(),
      handleFusionChat: vi.fn(),
      detectRequiredCapabilities: vi.fn(() => new Set()),
    },
    model: {
      getModelInfo: vi.fn(async (modelStr) => state.models[modelStr] || { provider: null }),
      getComboModels: vi.fn(async (modelStr) => state.combos[modelStr] || null),
    },
    providers: {
      AI_PROVIDERS: {
        openai: {
          id: "openai",
          serviceKinds: ["tts", "stt", "embedding", "image", "llm"],
          ttsConfig: { authType: "bearer" },
          sttConfig: { authType: "bearer" },
          embeddingConfig: {},
          imageConfig: {},
        },
        tavily: { id: "tavily", searchConfig: {} },
        jina: { id: "jina", fetchConfig: {} },
        xai: { id: "xai" },
      },
      resolveProviderId: (id) => id,
    },
  };
  state.combo.getComboModelsFromData = (modelStr, combos) => {
    if (modelStr.includes("/")) return null;
    const list = Array.isArray(combos) ? combos : combos?.combos || [];
    const hit = list.find((combo) => combo.name === modelStr);
    if (hit?.models?.length) return hit.models;
    return state.combos[modelStr] || null;
  };
  return state;
});

vi.mock("@/sse/services/auth.js", () => fx.auth);
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(async () => {}),
}));
vi.mock("@/sse/services/model.js", () => fx.model);
vi.mock("@/sse/services/keyAccess.js", () => ({
  getKeyAccessContext: vi.fn(async () => ({})),
  enforceKeyAccess: vi.fn(async () => null),
  enforceKeyAccessResolved: vi.fn(async () => null),
  enforceKeyAccessProvider: vi.fn(async () => null),
  filterAdapterModels: vi.fn(async (_context, models) => models),
}));
vi.mock("@/sse/services/antigravityQuota.js", () => ({
  handleAntigravityQuotaError: vi.fn(async () => null),
  clearAntigravityStrikes: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  line: vi.fn(),
  errorLine: vi.fn(),
  maskKey: vi.fn((key) => key),
  tagForSession: vi.fn(() => "tag"),
  nextTag: vi.fn(() => "tag"),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => fx.settings,
  getCombos: async () => Object.entries(fx.combos).map(([name, models]) => ({ name, models })),
  getComboByName: async (name) => (fx.combos[name] ? { name, models: fx.combos[name] } : null),
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
  getModelAliases: async () => ({}),
  getProviderNodes: async () => [],
}));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://localhost/headroom" }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn(async () => null) }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("@/shared/constants/providers.js", () => fx.providers);
vi.mock("@/shared/constants/providers", () => fx.providers);
vi.mock("@/shared/utils/ssrfGuard.js", () => ({ assertPublicUrlResolved: vi.fn(async () => {}) }));
vi.mock("open-sse/index.js", () => ({}));
// Upstream imageGeneration now imports the adapter registry, whose web adapters
// import the executor index. Core handlers are mocked here, so keep the executor
// graph (and its translator registration side effects) out of this routing test.
vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(),
  hasSpecializedExecutor: vi.fn(() => false),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: fx.core.handleChatCore }));
vi.mock("open-sse/handlers/embeddingsCore.js", () => ({ handleEmbeddingsCore: fx.core.handleEmbeddingsCore }));
vi.mock("open-sse/handlers/search/index.js", () => ({ handleSearchCore: fx.core.handleSearchCore }));
vi.mock("open-sse/handlers/fetch/index.js", () => ({ handleFetchCore: fx.core.handleFetchCore }));
vi.mock("open-sse/handlers/imageGenerationCore.js", () => ({ handleImageGenerationCore: fx.core.handleImageGenerationCore }));
vi.mock("open-sse/handlers/ttsCore.js", () => ({ handleTtsCore: fx.core.handleTtsCore }));
vi.mock("open-sse/handlers/sttCore.js", () => ({ handleSttCore: fx.core.handleSttCore }));
vi.mock("open-sse/handlers/systemoneCore.js", () => ({ handleSystemoneCore: fx.core.handleSystemoneCore }));
vi.mock("open-sse/handlers/videoCore.js", () => ({
  handleVideoProxyCore: fx.core.handleVideoProxyCore,
  getVideoConfig: (provider) => (provider === "xai" ? { path: "/v1/videos" } : null),
  sanitizeSecrets: (value) => value,
}));
vi.mock("open-sse/services/combo.js", () => fx.combo);
vi.mock("open-sse/services/capacityAdapter.js", () => ({
  augmentModelsWithCapacityAdapter: (models) => models,
  withCapacityAdapterStripping: (handler) => handler,
  getActiveAdapterStrategy: () => "fallback",
}));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn(async () => null) }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn(async () => {}) }));

import { setWebhookSink } from "@/lib/webhooks/events.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { handleEmbeddings } from "@/sse/handlers/embeddings.js";
import { handleSearch } from "@/sse/handlers/search.js";
import { handleFetch } from "@/sse/handlers/fetch.js";
import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";
import { handleTts } from "@/sse/handlers/tts.js";
import { handleStt } from "@/sse/handlers/stt.js";
import { handleSystemone } from "@/sse/handlers/systemone.js";
import { handleVideoCreate, handleVideoGet } from "@/sse/handlers/videoGeneration.js";
import { POST as compactPost } from "@/app/api/v1/responses/compact/route.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CLASSES = new Set([
  "upstream_http", "upstream_network", "upstream_timeout", "no_credentials",
  "all_unavailable", "stream_failed", "refresh_failed", "internal",
]);

let sinkEvents = [];

const installSink = () => {
  sinkEvents = [];
  setWebhookSink((event) => sinkEvents.push(event));
  return sinkEvents;
};

const finalEvents = () => sinkEvents.filter((event) => event.type === "request.failed");

const expectSingleFinal = (modality) => {
  const finals = finalEvents();
  expect(finals).toHaveLength(1);
  const event = finals[0];
  expect(event.id).toMatch(UUID_RE);
  expect(event.schema_version).toBe(1);
  expect(event.severity).toBe("error");
  expect(typeof event.data?.modality).toBe("string");
  expect(event.data.modality.length).toBeGreaterThan(0);
  if (modality) expect(event.data.modality).toBe(modality);
  if (event.data.errorClass !== undefined) expect(ERROR_CLASSES.has(event.data.errorClass)).toBe(true);
  return event;
};

const account = (overrides = {}) => ({
  connectionId: "conn-1",
  connectionName: "Account 1",
  accessToken: "token-1",
  refreshToken: "refresh-1",
  ...overrides,
});

const jsonResponse = (body = { ok: true }, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const okJsonCore = (body = { ok: true }) => ({ success: true, response: jsonResponse(body) });

const failCore = (status = 500, message = "upstream exploded") => ({
  success: false,
  status,
  error: message,
  response: jsonResponse({ error: { message } }, status),
});

const rateLimited = () => ({
  allRateLimited: true,
  lastError: "quota exhausted",
  lastErrorCode: 429,
  retryAfter: new Date(Date.now() + 30_000).toISOString(),
  retryAfterHuman: "reset after 30s",
});

const postJson = (path, body, headers = {}) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const postRaw = (path, raw) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: raw,
});

const snapshot = async (response) => ({
  status: response.status,
  contentType: response.headers.get("content-type"),
  retryAfter: response.headers.get("retry-after"),
  body: await response.text(),
});

const chatRequest = (model = "openai/model-a", extra = {}) => postJson("/v1/chat/completions", {
  model,
  messages: [{ role: "user", content: "hello" }],
  ...extra,
});

const setupDefaults = () => {
  fx.settings = { requireApiKey: false, comboStrategy: "fallback" };
  fx.combos = {};
  fx.models = {
    "openai/model-a": { provider: "openai", model: "model-a" },
    "openai/model-b": { provider: "openai", model: "model-b" },
    "openai/model-c": { provider: "openai", model: "model-c" },
    "openai/text-embedding-3-small": { provider: "openai", model: "text-embedding-3-small" },
    "openai/tts-1": { provider: "openai", model: "tts-1" },
    "openai/whisper-1": { provider: "openai", model: "whisper-1" },
    "xai/grok-imagine-video": { provider: "xai", model: "grok-imagine-video" },
  };

  fx.auth.getProviderCredentials.mockReset().mockResolvedValue(account());
  fx.auth.markAccountUnavailable.mockReset().mockResolvedValue({ shouldFallback: false });
  fx.auth.clearAccountError.mockReset().mockResolvedValue(undefined);
  fx.auth.extractApiKey.mockReset().mockReturnValue(null);
  fx.auth.isValidApiKey.mockReset().mockResolvedValue(true);

  for (const core of Object.values(fx.core)) core.mockReset();
  fx.core.handleChatCore.mockResolvedValue(okJsonCore({ id: "chat-ok" }));
  fx.core.handleEmbeddingsCore.mockResolvedValue(okJsonCore({ data: [] }));
  fx.core.handleSearchCore.mockResolvedValue(okJsonCore({ results: [] }));
  fx.core.handleFetchCore.mockResolvedValue({ success: true, data: { title: "page" } });
  fx.core.handleImageGenerationCore.mockResolvedValue(okJsonCore({ data: [] }));
  fx.core.handleTtsCore.mockResolvedValue({ success: true, response: new Response("audio", { status: 200, headers: { "Content-Type": "audio/mpeg" } }) });
  fx.core.handleSttCore.mockResolvedValue(okJsonCore({ text: "hello" }));
  fx.core.handleSystemoneCore.mockResolvedValue(okJsonCore({ answers: {} }));
  fx.core.handleVideoProxyCore.mockResolvedValue({ success: true, response: jsonResponse({ request_id: "video-1" }) });

  fx.combo.handleComboChat.mockReset();
  fx.combo.handleFusionChat.mockReset();
  fx.combo.detectRequiredCapabilities.mockReset().mockReturnValue(new Set());
  fx.combo.handleComboChat.mockImplementation(async ({ models, handleSingleModel }) => {
    let lastStatus = 0;
    for (const model of models) {
      const response = await handleSingleModel({}, model);
      if (response.status < 500) return response;
      lastStatus = response.status;
    }
    return jsonResponse({ error: { message: "All combo models unavailable" } }, lastStatus >= 500 ? 503 : lastStatus);
  });
  fx.combo.handleFusionChat.mockImplementation(async ({ models, handleSingleModel }) => {
    let lastResponse = null;
    for (const model of models) {
      const response = await handleSingleModel({}, model, true);
      if (response.ok) return response;
      lastResponse = response;
    }
    return lastResponse || jsonResponse({ error: { message: "All fusion models unavailable" } }, 503);
  });
};

beforeEach(() => {
  installSink();
  setupDefaults();
});

afterEach(() => {
  setWebhookSink(null);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const DEADLINE = Symbol("deadline");

const beforeDeadline = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(DEADLINE), ms);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); },
  );
});

const BINARY_CHUNKS = [Uint8Array.from([0x49, 0x44, 0x33]), Uint8Array.from([0x04, 0x00])];

function trackedBinaryResponse({ fail = false } = {}) {
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls <= BINARY_CHUNKS.length) controller.enqueue(BINARY_CHUNKS[pulls - 1].slice());
      else if (fail) controller.error(new Error("fixture binary transport reset"));
      else controller.close();
    },
  }, { highWaterMark: 0 });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "audio/mpeg", "x-upstream": "fixture-binary" },
    }),
    pulls: () => pulls,
  };
}

describe("webhook routing: chat root final owner", () => {
  it("recovered account fallback emits zero final despite the previous attempt failing", async () => {
    fx.auth.getProviderCredentials
      .mockResolvedValueOnce(account({ connectionId: "conn-1" }))
      .mockResolvedValueOnce(account({ connectionId: "conn-2" }));
    fx.auth.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true });
    fx.core.handleChatCore
      .mockResolvedValueOnce(failCore(500, "first attempt failed"))
      .mockResolvedValueOnce(okJsonCore({ id: "second-attempt" }));

    const response = await handleChat(chatRequest());

    expect(response.status).toBe(200);
    expect(finalEvents()).toHaveLength(0);
  });

  it("exhausted fallback emits exactly one admitted root event", async () => {
    fx.auth.getProviderCredentials
      .mockResolvedValueOnce(account({ connectionId: "conn-1" }))
      .mockResolvedValueOnce(account({ connectionId: "conn-2" }))
      .mockResolvedValueOnce(null);
    fx.auth.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
    fx.core.handleChatCore.mockResolvedValue(failCore(500, "upstream exploded"));

    const response = await handleChat(chatRequest());

    expect(response.status).toBeGreaterThanOrEqual(500);
    expectSingleFinal("chat");
    expect(fx.auth.getProviderCredentials).toHaveBeenCalledTimes(3);
  });

  it("a fatal non-fallback upstream error emits one upstream_http event", async () => {
    fx.core.handleChatCore.mockResolvedValueOnce(failCore(400, "bad request"));
    fx.auth.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: false });

    const response = await handleChat(chatRequest());

    expect(response.status).toBe(400);
    expect(expectSingleFinal("chat").data.errorClass).toBe("upstream_http");
  });

  it("no credentials emits one no_credentials event", async () => {
    fx.auth.getProviderCredentials.mockResolvedValueOnce(null);

    const response = await handleChat(chatRequest());

    expect(response.status).toBe(404);
    expect(expectSingleFinal("chat").data.errorClass).toBe("no_credentials");
  });

  it("all accounts rate limited emits one all_unavailable event", async () => {
    fx.auth.getProviderCredentials.mockResolvedValueOnce(rateLimited());

    const response = await handleChat(chatRequest());

    expect(response.status).toBe(503);
    expect(expectSingleFinal("chat").data.errorClass).toBe("all_unavailable");
  });

  it("validation and auth failures emit zero events", async () => {
    const missingModel = await handleChat(postJson("/v1/chat/completions", { messages: [] }));
    expect(missingModel.status).toBe(400);

    const invalidJson = await handleChat(postRaw("/v1/chat/completions", "{not json"));
    expect(invalidJson.status).toBe(400);

    fx.settings = { ...fx.settings, requireApiKey: true };
    fx.auth.extractApiKey.mockReturnValue(null);
    const unauthorized = await handleChat(chatRequest());
    expect(unauthorized.status).toBe(401);

    expect(finalEvents()).toHaveLength(0);
    expect(fx.core.handleChatCore).not.toHaveBeenCalled();
  });

  it("HTTP 200 stream failure is finalized by the source terminal observer, not success headers", async () => {
    const request = chatRequest("openai/model-a", { stream: true });
    let captured = null;
    fx.core.handleChatCore.mockImplementationOnce(async (options) => {
      captured = options;
      setTimeout(() => {
        options.onStreamTerminal?.({
          outcome: "failed",
          errorClass: "stream_failed",
          partialResponse: true,
          statusCode: 200,
        });
      }, 0);
      return {
        success: true,
        response: new Response("data: {}\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      };
    });

    const response = await handleChat(request);
    expect(response.status).toBe(200);
    expect(typeof captured?.onStreamTerminal).toBe("function");
    expect(captured?.requestSignal).toBe(request.signal);
    await tick();

    const event = expectSingleFinal("chat");
    expect(event.data.errorClass).toBe("stream_failed");
    expect(event.data.partialResponse).toBe(true);
    expect(event.data.statusCode).toBe(200);
  });

  it("client cancellation after HTTP 200 emits zero events", async () => {
    const request = chatRequest("openai/model-a", { stream: true });
    fx.core.handleChatCore.mockImplementationOnce(async (options) => {
      setTimeout(() => {
        options.onStreamTerminal?.({ outcome: "client_cancelled", partialResponse: true });
      }, 0);
      return {
        success: true,
        response: new Response("data: {}\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      };
    });

    const response = await handleChat(request);
    expect(response.status).toBe(200);
    await tick();

    expect(finalEvents()).toHaveLength(0);
  });

  it("nested combo exhaustion followed by an outer success emits zero events", async () => {
    fx.combos = {
      outer: ["inner", "openai/model-b"],
      inner: ["openai/model-a", "openai/model-c"],
    };
    fx.core.handleChatCore.mockImplementation(async ({ modelInfo }) => (
      modelInfo.model === "model-b" ? okJsonCore({ id: "outer-ok" }) : failCore(500, `${modelInfo.model} failed`)
    ));

    const response = await handleChat(chatRequest("outer"));

    expect(response.status).toBe(200);
    expect(finalEvents()).toHaveLength(0);
  });

  it("all combo members failing emits exactly one root event", async () => {
    fx.combos = { broken: ["openai/model-a", "openai/model-c"] };
    fx.core.handleChatCore.mockImplementation(async ({ modelInfo }) => failCore(500, `${modelInfo.model} failed`));

    const response = await handleChat(chatRequest("broken"));

    expect(response.status).toBeGreaterThanOrEqual(500);
    expectSingleFinal("chat");
  });

  it("fusion panel reuse keeps one root: partial panel failure then success emits zero", async () => {
    fx.settings = { requireApiKey: false, comboStrategy: "fusion" };
    fx.combos = { fused: ["openai/model-a", "openai/model-b"] };
    fx.core.handleChatCore.mockImplementation(async ({ modelInfo }) => (
      modelInfo.model === "model-b" ? okJsonCore({ id: "panel-ok" }) : failCore(500, "panel failed")
    ));

    const response = await handleChat(chatRequest("fused"));

    expect(response.status).toBe(200);
    expect(finalEvents()).toHaveLength(0);
  });

  it("preserves status, headers and body with and without a sink", async () => {
    fx.auth.getProviderCredentials.mockResolvedValueOnce(rateLimited());

    const withSink = await snapshot(await handleChat(chatRequest()));
    expect(finalEvents()).toHaveLength(1);
    expect(withSink.status).toBe(503);
    expect(withSink.body).toContain("quota exhausted");

    setWebhookSink(null);
    sinkEvents = [];
    fx.auth.getProviderCredentials.mockResolvedValueOnce(rateLimited());

    const result = await handleChat(chatRequest());
    const withoutSink = await snapshot(result);

    expect(withoutSink).toEqual(withSink);
    expect(finalEvents()).toHaveLength(0);
  });

  it("non-2xx never-ending body cannot delay the response and leaves the original stream readable", async () => {
    const encoder = new TextEncoder();
    const bodyText = '{"error":{"message":"upstream gateway failure"}}';
    let pulls = 0;
    let streamController;
    const upstreamBody = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(encoder.encode(bodyText));
      },
    }, { highWaterMark: 0 });
    fx.core.handleChatCore.mockResolvedValueOnce({
      success: false,
      status: 502,
      error: "upstream gateway failure",
      response: new Response(upstreamBody, {
        status: 502,
        headers: { "Content-Type": "application/json", "x-upstream": "fixture-never-ending" },
      }),
    });

    const pending = handleChat(chatRequest());
    try {
      const returned = await beforeDeadline(pending, 250);
      expect(returned).not.toBe(DEADLINE);
      expect(returned.status).toBe(502);
      expect(returned.headers.get("x-upstream")).toBe("fixture-never-ending");
      expect(pulls).toBe(0);

      const reader = returned.body.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe(bodyText);
      await reader.cancel("test cleanup");
    } finally {
      try { streamController?.close(); } catch { /* already closed */ }
      await pending.catch(() => {});
    }
  });

  it("nested failed streaming request followed by outer success emits zero finals", async () => {
    fx.combos = {
      outer: ["inner", "openai/model-b"],
      inner: ["openai/model-a", "openai/model-c"],
    };
    fx.core.handleChatCore.mockImplementation(async ({ modelInfo }) => (
      modelInfo.model === "model-b"
        ? okJsonCore({ id: "outer-stream-ok" })
        : failCore(503, `${modelInfo.model} unavailable`)
    ));

    const response = await handleChat(chatRequest("outer", { stream: true }));

    expect(response.status).toBe(200);
    expect(finalEvents()).toHaveLength(0);
  });
});

describe("webhook routing: embeddings/search/fetch", () => {
  it("embeddings no-credentials failure emits one event; local validation emits zero", async () => {
    fx.auth.getProviderCredentials.mockResolvedValueOnce(null);
    const failed = await handleEmbeddings(postJson("/v1/embeddings", {
      model: "openai/text-embedding-3-small",
      input: "hello",
    }));
    expect(failed.status).toBe(400);
    const event = expectSingleFinal();
    expect(event.data.errorClass).toBe("no_credentials");

    sinkEvents = [];
    const invalid = await handleEmbeddings(postJson("/v1/embeddings", {
      model: "openai/text-embedding-3-small",
    }));
    expect(invalid.status).toBe(400);
    expect(finalEvents()).toHaveLength(0);
    expect(fx.core.handleEmbeddingsCore).not.toHaveBeenCalled();
  });

  it("embeddings success emits zero events", async () => {
    const response = await handleEmbeddings(postJson("/v1/embeddings", {
      model: "openai/text-embedding-3-small",
      input: ["a", "b"],
    }));
    expect(response.status).toBe(200);
    expect(finalEvents()).toHaveLength(0);
  });

  it("search terminal core failure emits one event; missing query emits zero", async () => {
    fx.core.handleSearchCore.mockResolvedValueOnce(failCore(502, "search upstream down"));

    const failed = await handleSearch(postJson("/v1/search", { provider: "tavily", query: "hello" }));
    expect(failed.status).toBe(502);
    expect(expectSingleFinal().data.errorClass).toBe("upstream_http");

    sinkEvents = [];
    const invalid = await handleSearch(postJson("/v1/search", { provider: "tavily" }));
    expect(invalid.status).toBe(400);
    expect(finalEvents()).toHaveLength(0);
  });

  it("search success emits zero events", async () => {
    const response = await handleSearch(postJson("/v1/search", { provider: "tavily", query: "hello" }));
    expect(response.status).toBe(200);
    expect(finalEvents()).toHaveLength(0);
  });

  it("fetch terminal core failure emits one event; blocked local URL emits zero", async () => {
    fx.core.handleFetchCore.mockResolvedValueOnce(failCore(502, "fetch upstream down"));

    const failed = await handleFetch(postJson("/v1/web/fetch", {
      provider: "jina",
      url: "https://example.com/page",
    }));
    expect(failed.status).toBe(502);
    expect(expectSingleFinal().data.errorClass).toBe("upstream_http");

    sinkEvents = [];
    const invalid = await handleFetch(postJson("/v1/web/fetch", { provider: "jina", url: "not-a-url" }));
    expect(invalid.status).toBe(400);
    expect(finalEvents()).toHaveLength(0);
    expect(fx.core.handleFetchCore).toHaveBeenCalledTimes(1);
  });

  it("fetch success emits zero events", async () => {
    const response = await handleFetch(postJson("/v1/web/fetch", {
      provider: "jina",
      url: "https://example.com/page",
    }));
    expect(response.status).toBe(200);
    expect(finalEvents()).toHaveLength(0);
  });
});

describe("webhook routing: image/tts/stt/systemone", () => {
  it("image generation terminal failure emits one event; missing prompt emits zero", async () => {
    fx.models["openai/gpt-image-1"] = { provider: "openai", model: "gpt-image-1" };
    fx.core.handleImageGenerationCore.mockResolvedValueOnce(failCore(500, "image upstream down"));

    const failed = await handleImageGeneration(postJson("/v1/images/generations", {
      model: "openai/gpt-image-1",
      prompt: "a cat",
    }));
    expect(failed.status).toBe(500);
    expect(expectSingleFinal().data.errorClass).toBe("upstream_http");

    sinkEvents = [];
    const invalid = await handleImageGeneration(postJson("/v1/images/generations", {
      model: "openai/gpt-image-1",
    }));
    expect(invalid.status).toBe(400);
    expect(finalEvents()).toHaveLength(0);
  });

  it("tts no-credentials failure emits one event; missing input emits zero", async () => {
    fx.auth.getProviderCredentials.mockResolvedValueOnce(null);

    const failed = await handleTts(postJson("/v1/audio/speech", {
      model: "openai/tts-1",
      input: "hello",
    }));
    expect(failed.status).toBe(400);
    expect(expectSingleFinal().data.errorClass).toBe("no_credentials");

    sinkEvents = [];
    const invalid = await handleTts(postJson("/v1/audio/speech", { model: "openai/tts-1" }));
    expect(invalid.status).toBe(400);
    expect(finalEvents()).toHaveLength(0);
    expect(fx.core.handleTtsCore).not.toHaveBeenCalled();
  });

  it("stt no-credentials failure emits one event; missing file emits zero", async () => {
    const makeForm = (withFile) => {
      const form = new FormData();
      form.set("model", "openai/whisper-1");
      if (withFile) form.set("file", new Blob(["audio"], { type: "audio/wav" }), "clip.wav");
      return new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body: form });
    };

    fx.auth.getProviderCredentials.mockResolvedValueOnce(null);
    const failed = await handleStt(makeForm(true));
    expect(failed.status).toBe(400);
    expect(expectSingleFinal().data.errorClass).toBe("no_credentials");

    sinkEvents = [];
    const invalid = await handleStt(makeForm(false));
    expect(invalid.status).toBe(400);
    expect(finalEvents()).toHaveLength(0);
    expect(fx.core.handleSttCore).not.toHaveBeenCalled();
  });

  it("systemone terminal failure emits one event; missing state emits zero", async () => {
    fx.core.handleSystemoneCore.mockResolvedValueOnce(failCore(500, "systemone upstream down"));

    const failed = await handleSystemone(postJson("/v1/systemone", {
      model: "openai/model-a",
      state: {},
      questions: {},
    }));
    expect(failed.status).toBe(500);
    expect(expectSingleFinal().data.errorClass).toBe("upstream_http");

    sinkEvents = [];
    const invalid = await handleSystemone(postJson("/v1/systemone", {
      model: "openai/model-a",
      questions: {},
    }));
    expect(invalid.status).toBe(400);
    expect(finalEvents()).toHaveLength(0);
    expect(fx.core.handleSystemoneCore).toHaveBeenCalledTimes(1);
  });
});

describe("webhook routing: binary 2xx transport ownership", () => {
  it("binary 2xx reader failure emits one stream_failed and preserves status, headers and chunks without eager reads", async () => {
    const tracked = trackedBinaryResponse({ fail: true });
    fx.core.handleTtsCore.mockResolvedValueOnce({ success: true, response: tracked.response });

    const response = await handleTts(postJson("/v1/audio/speech", {
      model: "openai/tts-1",
      input: "hello",
    }));

    await tick();
    expect(tracked.pulls()).toBe(0);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("x-upstream")).toBe("fixture-binary");

    const reader = response.body.getReader();
    const first = await reader.read();
    const second = await reader.read();
    expect(Array.from(first.value)).toEqual(Array.from(BINARY_CHUNKS[0]));
    expect(Array.from(second.value)).toEqual(Array.from(BINARY_CHUNKS[1]));

    let failure = null;
    try { await reader.read(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("fixture binary transport reset");
    await tick();

    const event = expectSingleFinal("tts");
    expect(event.data.errorClass).toBe("stream_failed");
    expect(event.data.statusCode).toBe(200);
    expect(event.data.partialResponse).toBe(true);
    expect(fx.core.handleTtsCore).toHaveBeenCalledTimes(1);
  });

  it("binary 2xx client cancellation after bytes emits zero finals and never retries", async () => {
    const tracked = trackedBinaryResponse();
    fx.core.handleTtsCore.mockResolvedValueOnce({ success: true, response: tracked.response });

    const response = await handleTts(postJson("/v1/audio/speech", {
      model: "openai/tts-1",
      input: "hello",
    }));

    await tick();
    expect(tracked.pulls()).toBe(0);
    const reader = response.body.getReader();
    const first = await reader.read();
    expect(Array.from(first.value)).toEqual(Array.from(BINARY_CHUNKS[0]));
    await reader.cancel("client disconnected");
    await tick();

    expect(finalEvents()).toHaveLength(0);
    expect(tracked.pulls()).toBeGreaterThanOrEqual(1);
    expect(fx.core.handleTtsCore).toHaveBeenCalledTimes(1);
  });
});

describe("webhook routing: video create/get", () => {
  it("video create no-credentials failure emits one event; invalid JSON emits zero", async () => {
    fx.auth.getProviderCredentials.mockResolvedValueOnce(null);

    const failed = await handleVideoCreate(postJson("/v1/videos/generations", {
      model: "xai/grok-imagine-video",
      prompt: "a cat",
    }), "generations");
    expect(failed.status).toBe(400);
    expect(expectSingleFinal().data.errorClass).toBe("no_credentials");

    sinkEvents = [];
    const invalid = await handleVideoCreate(postRaw("/v1/videos/generations", "{not json"), "generations");
    expect(invalid.status).toBe(400);
    expect(finalEvents()).toHaveLength(0);
  });

  it("video create success emits zero events", async () => {
    const response = await handleVideoCreate(postJson("/v1/videos/generations", {
      model: "xai/grok-imagine-video",
      prompt: "a cat",
    }), "generations");
    expect(response.status).toBe(200);
    expect(finalEvents()).toHaveLength(0);
  });

  it("video get terminal failure emits one event; missing id emits zero", async () => {
    fx.core.handleVideoProxyCore.mockResolvedValueOnce(failCore(500, "video upstream down"));

    const failed = await handleVideoGet(
      new Request("http://localhost/v1/videos/job-1", { method: "GET" }),
      "job-1",
    );
    expect(failed.status).toBe(500);
    expect(expectSingleFinal().data.errorClass).toBe("upstream_http");

    sinkEvents = [];
    const invalid = await handleVideoGet(
      new Request("http://localhost/v1/videos/", { method: "GET" }),
      null,
    );
    expect(invalid.status).toBe(400);
    expect(finalEvents()).toHaveLength(0);
    expect(fx.core.handleVideoProxyCore).toHaveBeenCalledTimes(1);
  });
});

describe("webhook routing: compact alias", () => {
  it("compact alias delegates to the chat root and emits exactly one final event", async () => {
    fx.core.handleChatCore.mockResolvedValueOnce(failCore(400, "compact upstream rejected"));
    fx.auth.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: false });

    const response = await compactPost(postJson("/v1/responses/compact", {
      model: "openai/model-a",
      input: [{ role: "user", content: "hello" }],
    }));

    expect(response.status).toBe(400);
    expectSingleFinal();
  });
});
