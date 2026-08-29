import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  track: vi.fn(async () => ({ apiKeyId: "key-id", fingerprint: "fingerprint" })),
  getSettings: vi.fn(async () => ({ requireApiKey: true })),
  getCombos: vi.fn(async () => []),
  extractApiKey: vi.fn((request) => {
    const auth = request.headers.get("authorization");
    return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  }),
  resolveApiKeyId: vi.fn(async () => "key-id"),
  getProviderCredentials: vi.fn(async () => null),
  getModelInfo: vi.fn(async (model) => {
    if (String(model).startsWith("invalid")) return { provider: null, model: null };
    const [provider = "test", ...rest] = String(model).split("/");
    return { provider, model: rest.join("/") || model };
  }),
  getComboModels: vi.fn(async () => null),
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/sse/services/apiKeyClientActivity.js", () => ({
  trackApiKeyClientActivity: mocks.track,
}));
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  resolveApiKeyId: mocks.resolveApiKeyId,
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(async () => {}),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getCombos: mocks.getCombos,
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: {
    test: {
      serviceKinds: ["tts", "stt"],
      ttsConfig: { authType: "bearer" },
      sttConfig: { authType: "bearer" },
      searchConfig: {},
      fetchConfig: {},
    },
    xai: {},
  },
  resolveProviderId: (id) => id,
}));
vi.mock("@/shared/utils/ssrfGuard.js", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({
  getComboModelsFromData: vi.fn(() => null),
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: vi.fn() }));
vi.mock("open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: mocks.handleBypassRequest,
}));
vi.mock("open-sse/handlers/videoCore.js", () => ({
  VIDEO_ACTIONS: new Set(["generations", "edits", "extensions"]),
  getVideoConfig: vi.fn((provider) => provider === "xai" ? {} : null),
  handleVideoProxyCore: vi.fn(),
  sanitizeSecrets: (value) => value,
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(), error: vi.fn(), info: vi.fn(), request: vi.fn(), warn: vi.fn(),
  maskKey: vi.fn(() => "masked"),
}));

const { handleChat } = await import("@/sse/handlers/chat.js");
const { handleEmbeddings } = await import("@/sse/handlers/embeddings.js");
const { handleImageGeneration } = await import("@/sse/handlers/imageGeneration.js");
const { handleTts } = await import("@/sse/handlers/tts.js");
const { handleStt } = await import("@/sse/handlers/stt.js");
const { handleSearch } = await import("@/sse/handlers/search.js");
const { handleFetch } = await import("@/sse/handlers/fetch.js");
const { handleVideoCreate, handleVideoGet } = await import("@/sse/handlers/videoGeneration.js");

const jsonRequest = (path, body, apiKey = "valid-key") => new Request(`https://router.test${path}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  },
  body: JSON.stringify(body),
});

const sttRequest = ({ includeFile = true, apiKey = "valid-key" } = {}) => {
  const form = new FormData();
  form.set("model", "test/model");
  if (includeFile) form.set("file", new Blob(["audio"]), "sample.wav");
  return new Request("https://router.test/v1/audio/transcriptions", {
    method: "POST",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    body: form,
  });
};

const emptyVideoRequest = () => new Request("https://router.test/v1/videos/generations", {
  method: "POST",
  headers: { Authorization: "Bearer valid-key" },
});

const validCases = [
  ["chat", () => handleChat(jsonRequest("/v1/chat/completions", { model: "test/model" }))],
  ["messages", () => handleChat(jsonRequest("/v1/messages", { model: "test/model" }))],
  ["responses", () => handleChat(jsonRequest("/v1/responses", { model: "test/model" }))],
  ["Gemini rewrite", () => handleChat(jsonRequest(
    "/v1beta/models/gemini-2.5-flash:generateContent",
    { model: "test/model", messages: [] },
  ))],
  ["embeddings", () => handleEmbeddings(jsonRequest("/v1/embeddings", { model: "test/model", input: "hello" }))],
  ["image generation", () => handleImageGeneration(jsonRequest("/v1/images/generations", { model: "test/model", prompt: "hello" }))],
  ["TTS", () => handleTts(jsonRequest("/v1/audio/speech", { model: "test/model", input: "hello" }))],
  ["STT", () => handleStt(sttRequest())],
  ["search", () => handleSearch(jsonRequest("/v1/search", { provider: "test", query: "hello" }))],
  ["web fetch", () => handleFetch(jsonRequest("/v1/web/fetch", { provider: "test", url: "https://example.com" }))],
  ["video create", () => handleVideoCreate(jsonRequest("/v1/videos/generations", { model: "xai/video", prompt: "hello" }), "generations")],
  ["video poll", () => handleVideoGet(new Request("https://router.test/v1/videos/request-1", {
    headers: { Authorization: "Bearer valid-key" },
  }), "request-1")],
];

const malformedCases = [
  ["chat", () => handleChat(jsonRequest("/v1/chat/completions", {}))],
  ["embeddings", () => handleEmbeddings(jsonRequest("/v1/embeddings", { model: "test/model" }))],
  ["image generation", () => handleImageGeneration(jsonRequest("/v1/images/generations", { model: "test/model" }))],
  ["TTS", () => handleTts(jsonRequest("/v1/audio/speech", { model: "test/model" }))],
  ["STT", () => handleStt(sttRequest({ includeFile: false }))],
  ["search", () => handleSearch(jsonRequest("/v1/search", { provider: "test" }))],
  ["web fetch", () => handleFetch(jsonRequest("/v1/web/fetch", { provider: "test", url: "not-a-url" }))],
  ["video create", () => handleVideoCreate(jsonRequest("/v1/videos/generations", { model: "invalid/model" }), "generations")],
  ["video create without payload", () => handleVideoCreate(emptyVideoRequest(), "generations")],
  ["video create without model", () => handleVideoCreate(jsonRequest("/v1/videos/generations", { prompt: "hello" }), "generations")],
  ["video create with unknown action", () => handleVideoCreate(jsonRequest("/v1/videos/generations", { model: "xai/video" }), "unknown")],
  ["video poll", () => handleVideoGet(new Request("https://router.test/v1/videos/", {
    headers: { Authorization: "Bearer valid-key" },
  }), "")],
  ["video poll with whitespace ID", () => handleVideoGet(new Request("https://router.test/v1/videos/%20", {
    headers: { Authorization: "Bearer valid-key" },
  }), "   ")],
];

describe("API-key client endpoint admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.resolveApiKeyId.mockResolvedValue("key-id");
    mocks.getProviderCredentials.mockResolvedValue(null);
    mocks.getComboModels.mockResolvedValue(null);
    mocks.handleBypassRequest.mockReturnValue(null);
  });

  it.each(validCases)("tracks one admitted %s request", async (_name, invoke) => {
    await invoke();
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ apiKeyId: "key-id" }));
  });

  it.each(malformedCases)("tracks zero malformed %s requests", async (_name, invoke) => {
    await invoke();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it.each(["warmup", "naming"])("tracks a synthetic %s chat success", async () => {
    mocks.handleBypassRequest.mockReturnValue({ response: new Response("synthetic") });

    await handleChat(jsonRequest("/v1/chat/completions", { model: "test/model" }));

    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  it("tracks zero requests carrying an invalid API key", async () => {
    mocks.resolveApiKeyId.mockResolvedValue(null);
    await handleChat(jsonRequest("/v1/chat/completions", { model: "test/model" }, "invalid-key"));
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("tracks zero local requests without an API key", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    await handleChat(jsonRequest("/v1/chat/completions", { model: "test/model" }, null));
    expect(mocks.track).not.toHaveBeenCalled();
  });
});
