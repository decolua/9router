/**
 * F12 (audit T1.8 F4) — usage accounting for the NON-chat modalities.
 *
 * Before this task, only chat (via open-sse/handlers/chatCore/requestDetail.js
 * `saveUsageStats` → `saveRequestUsage`) and embeddings wrote a usage row.
 * images / videos / tts / stt / search / web-fetch consumed paid upstream
 * quota and were invisible to usageDb, and the gemini embedding adapter
 * normalized `usage` to hard zeros.
 *
 * Contract asserted here (the recorder API is the existing one, unchanged):
 *   saveRequestUsage({ usageEventId, provider, model, connectionId, apiKey,
 *                      endpoint, status: "success", tokens })
 * with `tokens` in the canonical OpenAI shape (prompt_tokens/completion_tokens).
 * Cost is NOT passed: persistUsageEvent derives it through
 * getPricingForModel(provider, model) — see src/lib/db/repos/usageRepo.js.
 *
 * Token policy per modality (documented in the task report):
 *  - real upstream usage wins whenever the response exposes it;
 *  - otherwise REQUEST-SIDE text tokens are estimated at ~4 chars/token
 *    (the same convention as open-sse/utils/usageTracking.js estimateInputTokens);
 *  - STT/web-fetch also expose real TEXT output, so it is counted as completion;
 *  - accounting is fail-open: a recorder that throws must never change the
 *    response the client receives.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRequestUsage: vi.fn(),
  // auth / credentials
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => "client-key"),
  isValidApiKey: vi.fn(async () => true),
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getComboByName: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  checkAndRefreshToken: vi.fn(async (_p, creds) => creds),
  updateProviderCredentials: vi.fn(async () => {}),
  // model resolution
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(async () => null),
  // cores (mocked: this file tests the handler-level accounting only)
  handleImageGenerationCore: vi.fn(),
  handleVideoProxyCore: vi.fn(),
  handleTtsCore: vi.fn(),
  handleSttCore: vi.fn(),
  handleSearchCore: vi.fn(),
  handleFetchCore: vi.fn(),
  handleEmbeddingsCore: vi.fn(),
  // ssrf guard is exercised by its own suite
  assertPublicUrlResolved: vi.fn(async () => {}),
}));

vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: mocks.saveRequestUsage }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getComboByName: mocks.getComboByName,
  getCombos: mocks.getCombos,
  getProviderConnectionById: vi.fn(async () => null),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
}));
vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), maskKey: vi.fn(() => "masked"),
}));
vi.mock("@/shared/utils/ssrfGuard.js", () => ({ assertPublicUrlResolved: mocks.assertPublicUrlResolved }));

vi.mock("open-sse/handlers/imageGenerationCore.js", () => ({
  handleImageGenerationCore: mocks.handleImageGenerationCore,
}));
vi.mock("open-sse/handlers/videoCore.js", () => ({
  handleVideoProxyCore: mocks.handleVideoProxyCore,
  getVideoConfig: (p) => (p === "xai" ? { baseUrl: "https://api.x.ai/v1" } : null),
  sanitizeSecrets: (msg) => msg,
}));
vi.mock("open-sse/handlers/ttsCore.js", () => ({
  handleTtsCore: mocks.handleTtsCore,
  VOICE_FETCHERS: {},
  fetchEdgeTtsVoices: vi.fn(),
  fetchLocalDeviceVoices: vi.fn(),
  fetchElevenLabsVoices: vi.fn(),
}));
vi.mock("open-sse/handlers/sttCore.js", () => ({ handleSttCore: mocks.handleSttCore }));
vi.mock("open-sse/handlers/search/index.js", () => ({ handleSearchCore: mocks.handleSearchCore }));
vi.mock("open-sse/handlers/fetch/index.js", () => ({ handleFetchCore: mocks.handleFetchCore }));
vi.mock("open-sse/handlers/embeddingsCore.js", () => ({ handleEmbeddingsCore: mocks.handleEmbeddingsCore }));

import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";
import { handleVideoCreate, handleVideoGet } from "@/sse/handlers/videoGeneration.js";
import { handleTts } from "@/sse/handlers/tts.js";
import { handleStt } from "@/sse/handlers/stt.js";
import { handleSearch } from "@/sse/handlers/search.js";
import { handleFetch } from "@/sse/handlers/fetch.js";
import { handleEmbeddings } from "@/sse/handlers/embeddings.js";
import geminiEmbeddingAdapter from "open-sse/handlers/embeddingProviders/gemini.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

const audio = (bytes = 2048, status = 200) =>
  new Response(new Uint8Array(bytes), { status, headers: { "Content-Type": "audio/mpeg" } });

const post = (path, body) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// ~4 chars per token, the estimator convention of usageTracking.js
const est = (text) => Math.ceil((text || "").length / 4);

/**
 * Accounting is fire-and-forget (it must never add latency to the response),
 * so the recorded call may land a microtask/IO turn later.
 */
async function recordedCall() {
  await vi.waitFor(() => expect(mocks.saveRequestUsage).toHaveBeenCalled(), { timeout: 2000 });
  return mocks.saveRequestUsage.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  mocks.getComboModels.mockResolvedValue(null);
  mocks.getProviderCredentials.mockResolvedValue({
    apiKey: "provider-secret",
    accessToken: "provider-token",
    connectionId: "conn-1",
    connectionName: "Account One",
  });
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
  mocks.saveRequestUsage.mockResolvedValue(undefined);
  mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-image-1" });
});

describe("images — /v1/images/generations usage", () => {
  it("records real upstream usage when the provider returns it", async () => {
    mocks.handleImageGenerationCore.mockResolvedValue({
      success: true,
      response: json({
        created: 1,
        data: [{ url: "https://cdn.example/img.png" }],
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      }),
    });

    const res = await handleImageGeneration(post("/v1/images/generations", {
      model: "openai/gpt-image-1",
      prompt: "a red square",
    }));
    expect(res.status).toBe(200);

    const entry = await recordedCall();
    expect(entry).toMatchObject({
      provider: "openai",
      model: "gpt-image-1",
      connectionId: "conn-1",
      apiKey: "client-key",
      endpoint: "/v1/images/generations",
      status: "success",
    });
    expect(typeof entry.usageEventId).toBe("string");
    expect(entry.tokens).toEqual({ prompt_tokens: 100, completion_tokens: 50 });
  });

  it("falls back to request-side token estimate when upstream sends no usage", async () => {
    const prompt = "a cinematic shot of a lighthouse at dawn, 4k";
    mocks.handleImageGenerationCore.mockResolvedValue({
      success: true,
      response: json({ created: 1, data: [{ url: "https://cdn.example/img.png" }] }),
    });

    await handleImageGeneration(post("/v1/images/generations", { model: "openai/dall-e-3", prompt }));

    const entry = await recordedCall();
    expect(entry.tokens).toEqual({ prompt_tokens: est(prompt), completion_tokens: 0 });
    expect(entry.model).toBe("gpt-image-1");
  });

  it("records the noAuth (local) path too", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "sdwebui", model: "sd-xl" });
    mocks.handleImageGenerationCore.mockResolvedValue({ success: true, response: json({ created: 1, data: [] }) });

    await handleImageGeneration(post("/v1/images/generations", { model: "sdwebui/sd-xl", prompt: "hello world" }));

    const entry = await recordedCall();
    expect(entry.provider).toBe("sdwebui");
    expect(entry.tokens.prompt_tokens).toBe(est("hello world"));
  });

  it("never records on a failed generation", async () => {
    mocks.handleImageGenerationCore.mockResolvedValue({
      success: false, status: 502, error: "upstream blew up", response: json({ error: "upstream blew up" }, 502),
    });

    const res = await handleImageGeneration(post("/v1/images/generations", { model: "openai/gpt-image-1", prompt: "x" }));
    expect(res.status).toBe(502);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });

  it("does not consume the binary response body", async () => {
    mocks.handleImageGenerationCore.mockResolvedValue({
      success: true,
      response: new Response(Buffer.from("fake-png-bytes"), { headers: { "Content-Type": "image/png" } }),
    });

    const res = await handleImageGeneration(post("/v1/images/generations", { model: "openai/gpt-image-1", prompt: "abc" }));
    const text = await res.text();
    expect(text).toBe("fake-png-bytes");
    const entry = await recordedCall();
    expect(entry.tokens.prompt_tokens).toBe(est("abc"));
  });
});

describe("videos — /v1/videos/* usage", () => {
  beforeEach(() => {
    mocks.getModelInfo.mockResolvedValue({ provider: "xai", model: "grok-imagine-video" });
  });

  it("records the billable create with an upstream usage payload when present", async () => {
    mocks.handleVideoProxyCore.mockResolvedValue({
      success: true,
      response: json({ id: "vid-1", status: "queued", usage: { prompt_tokens: 64, completion_tokens: 512, total_tokens: 576 } }),
    });

    const res = await handleVideoCreate(post("/v1/videos/generations", { model: "xai/grok-imagine-video", prompt: "a drone shot" }));
    expect(res.status).toBe(200);

    const entry = await recordedCall();
    expect(entry).toMatchObject({
      provider: "xai",
      model: "grok-imagine-video",
      connectionId: "conn-1",
      endpoint: "/v1/videos/generations",
      status: "success",
    });
    expect(entry.tokens).toEqual({ prompt_tokens: 64, completion_tokens: 512 });
  });

  it("estimates request tokens when the job payload carries no usage", async () => {
    const prompt = "a drone shot over a coastline";
    mocks.handleVideoProxyCore.mockResolvedValue({ success: true, response: json({ id: "vid-1", status: "queued" }) });

    await handleVideoCreate(post("/v1/videos/generations", { model: "xai/grok-imagine-video", prompt }));

    const entry = await recordedCall();
    expect(entry.tokens).toEqual({ prompt_tokens: est(prompt), completion_tokens: 0 });
  });

  it("does NOT record status polls (a job is billed once, at create)", async () => {
    mocks.handleVideoProxyCore.mockResolvedValue({ success: true, response: json({ id: "vid-1", status: "completed" }) });

    const res = await handleVideoGet(new Request("http://localhost/v1/videos/vid-1", { method: "GET" }), "vid-1");
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });
});

describe("tts — /v1/audio/speech usage", () => {
  beforeEach(() => {
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o-mini-tts" });
  });

  it("records the synthesized input as request tokens", async () => {
    const input = "Once upon a time, in a land of tokens and routes.";
    mocks.handleTtsCore.mockResolvedValue({ success: true, response: audio() });

    const res = await handleTts(post("/v1/audio/speech", { model: "openai/gpt-4o-mini-tts", input, voice: "alloy" }));
    expect(res.status).toBe(200);
    // the audio body must survive untouched
    expect((await res.arrayBuffer()).byteLength).toBe(2048);

    const entry = await recordedCall();
    expect(entry).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      connectionId: "conn-1",
      apiKey: "client-key",
      endpoint: "/v1/audio/speech",
      status: "success",
    });
    expect(entry.tokens).toEqual({ prompt_tokens: est(input), completion_tokens: 0 });
  });

  it("never records on a failed synthesis", async () => {
    mocks.handleTtsCore.mockResolvedValue({ success: false, status: 502, error: "voice unavailable" });
    const res = await handleTts(post("/v1/audio/speech", { model: "openai/gpt-4o-mini-tts", input: "hello" }));
    expect(res.status).toBe(502);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });
});

describe("stt — /v1/audio/transcriptions usage", () => {
  const transcriptionRequest = async () => {
    const fd = new FormData();
    fd.append("model", "openai/whisper-1");
    fd.append("file", new Blob([new Uint8Array(4096)], { type: "audio/wav" }), "a.wav");
    return new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body: fd });
  };

  beforeEach(() => {
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "whisper-1" });
  });

  it("records the transcript as produced (completion) tokens", async () => {
    const text = "the quick brown fox jumps over the lazy dog again and again";
    mocks.handleSttCore.mockResolvedValue({ success: true, response: json({ text }) });

    const res = await handleStt(await transcriptionRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe(text);

    const entry = await recordedCall();
    expect(entry).toMatchObject({
      provider: "openai",
      model: "whisper-1",
      connectionId: "conn-1",
      endpoint: "/v1/audio/transcriptions",
      status: "success",
    });
    expect(entry.tokens).toEqual({ prompt_tokens: 0, completion_tokens: est(text) });
  });

  it("prefers real upstream usage when the provider sends it", async () => {
    mocks.handleSttCore.mockResolvedValue({
      success: true,
      response: json({ text: "short", usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }),
    });

    await handleStt(await transcriptionRequest());

    const entry = await recordedCall();
    expect(entry.tokens).toEqual({ prompt_tokens: 12, completion_tokens: 3 });
  });

  it("records nothing when there is neither usage nor text", async () => {
    mocks.handleSttCore.mockResolvedValue({ success: true, response: json({ text: "" }) });

    await handleStt(await transcriptionRequest());
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });
});

describe("search — /v1/search usage", () => {
  beforeEach(() => {
    mocks.getModelInfo.mockResolvedValue({ provider: "tavily", model: "tavily" });
  });

  it("records the query and the provider-reported usage fields", async () => {
    const query = "latest developments in routing gateways";
    mocks.handleSearchCore.mockResolvedValue({
      success: true,
      data: {
        provider: "tavily",
        query,
        results: [{ title: "a", url: "https://a", content: "body text here" }],
        usage: { queries_used: 1, search_cost_usd: 0.01 },
      },
      response: json({ ok: true }),
    });

    const res = await handleSearch(post("/v1/search", { provider: "tavily", query }));
    expect(res.status).toBe(200);

    const entry = await recordedCall();
    expect(entry).toMatchObject({
      provider: "tavily",
      model: "tavily",
      connectionId: "conn-1",
      apiKey: "client-key",
      endpoint: "/v1/search",
      status: "success",
    });
    expect(entry.tokens).toEqual({ prompt_tokens: est(query), completion_tokens: 0 });
  });

  it("never records on a failed search", async () => {
    mocks.handleSearchCore.mockResolvedValue({
      success: false, status: 429, error: "rate limited", response: json({ error: "rate limited" }, 429),
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });

    const res = await handleSearch(post("/v1/search", { provider: "tavily", query: "anything" }));
    expect(res.status).toBe(429);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });
});

describe("web fetch — /v1/web/fetch usage", () => {
  it("records the fetched document as produced text tokens", async () => {
    const text = "Extracted article body, many words long, returned to the caller.";
    mocks.handleFetchCore.mockResolvedValue({
      success: true,
      data: { provider: "jina-reader", url: "https://example.com/article", content: { format: "markdown", text, length: text.length }, usage: { fetch_cost_usd: 0.001 } },
    });

    const res = await handleFetch(post("/v1/web/fetch", { provider: "jina-reader", url: "https://example.com/article" }));
    expect(res.status).toBe(200);

    const entry = await recordedCall();
    expect(entry).toMatchObject({
      provider: "jina-reader",
      model: "jina-reader",
      connectionId: "conn-1",
      endpoint: "/v1/web/fetch",
      status: "success",
    });
    expect(entry.tokens).toEqual({
      prompt_tokens: est("https://example.com/article"),
      completion_tokens: est(text),
    });
  });

  it("never records on a failed fetch", async () => {
    mocks.handleFetchCore.mockResolvedValue({ success: false, status: 502, error: "upstream down" });

    const res = await handleFetch(post("/v1/web/fetch", { provider: "jina-reader", url: "https://example.com/x" }));
    expect(res.status).toBe(502);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });
});

describe("fail-open — accounting never breaks a request", () => {
  beforeEach(() => {
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o-mini-tts" });
  });

  it("a recorder that THROWS SYNCHRONOUSLY still returns the audio response", async () => {
    mocks.saveRequestUsage.mockImplementation(() => {
      throw new Error("db is on fire");
    });
    mocks.handleTtsCore.mockResolvedValue({ success: true, response: audio() });

    const res = await handleTts(post("/v1/audio/speech", { model: "openai/gpt-4o-mini-tts", input: "hello there" }));
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(2048);
  });

  it("a recorder promise that REJECTS still returns the image response", async () => {
    mocks.saveRequestUsage.mockRejectedValue(new Error("write failed"));
    mocks.handleImageGenerationCore.mockResolvedValue({ success: true, response: json({ created: 1, data: [{ url: "u" }] }) });

    const res = await handleImageGeneration(post("/v1/images/generations", { model: "openai/gpt-image-1", prompt: "hello" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data[0].url).toBe("u");
  });
});

describe("embeddings — gemini adapter propagates upstream usageMetadata", () => {
  it("single embedContent: tokenCount flows into usage", () => {
    const out = geminiEmbeddingAdapter.normalize(
      { embedding: { values: [0.1, 0.2] }, usageMetadata: { promptTokenCount: 17, totalTokenCount: 17 } },
      "gemini-embedding-001"
    );
    expect(out.usage).toEqual({ prompt_tokens: 17, total_tokens: 17 });
  });

  it("batchEmbedContents: totalTokenCount flows into usage", () => {
    const out = geminiEmbeddingAdapter.normalize(
      { embeddings: [{ values: [0.1] }, { values: [0.2] }], usageMetadata: { totalTokenCount: 42 } },
      "gemini-embedding-001"
    );
    expect(out.usage).toEqual({ prompt_tokens: 42, total_tokens: 42 });
  });

  it("stays at zero (not a lie of a different shape) when upstream sends no usageMetadata", () => {
    const out = geminiEmbeddingAdapter.normalize({ embedding: { values: [0.1] } }, "gemini-embedding-001");
    expect(out.usage).toEqual({ prompt_tokens: 0, total_tokens: 0 });
  });

  it("the recorded embedding event carries the propagated tokens", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "gemini", model: "gemini-embedding-001" });
    mocks.handleEmbeddingsCore.mockResolvedValue({
      success: true,
      usage: { prompt_tokens: 17, total_tokens: 17 },
      response: json({ object: "list", data: [] }),
    });

    const res = await handleEmbeddings(post("/v1/embeddings", { model: "gemini/gemini-embedding-001", input: "hello" }));
    expect(res.status).toBe(200);

    const entry = await recordedCall();
    expect(entry).toMatchObject({ provider: "gemini", model: "gemini-embedding-001", endpoint: "/v1/embeddings" });
    expect(entry.tokens).toEqual({ prompt_tokens: 17, completion_tokens: 0, total_tokens: 17 });
  });
});
