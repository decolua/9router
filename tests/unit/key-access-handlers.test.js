// Per-API-key access control: every /v1 handler type is wired to the gate, the
// gate runs before any credential lookup, and a restricted key calling an allowed
// combo keeps combo failover (real combo.js).
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  combos: [
    { id: "c1", name: "Main", models: ["openai/model-a", "openai/model-b"] },
  ],
  keys: {},
  usage: { requests: 0, cost: 0 },
  requireApiKey: false,
}));
const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  handleChatCore: vi.fn(),
  handleTtsCore: vi.fn(),
  handleSttCore: vi.fn(),
  handleSearchCore: vi.fn(),
  handleFetchCore: vi.fn(),
  saveRequestUsage: vi.fn(),
  getProviderConnectionProviderById: vi.fn(),
  getProviderConnectionById: vi.fn(),
  isValidApiKey: vi.fn(),
  usageWriteFailure: false,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: fx.requireApiKey, comboStrategy: "fallback" }),
  getModelAliases: async () => ({}),
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getProviderNodes: async () => [],
  getCombos: async () => fx.combos,
  getProviderConnections: async () => [],
  getProviderConnectionById: mocks.getProviderConnectionById,
  getCustomModels: async () => [],
  // The upstream /v1/models routes read this key metadata; the fixture keys carry
  // only the fork's `access` field, so the upstream allowedModels filter is a
  // no-op here and the fork's access gate (keyAccess.js) stays authoritative.
  getApiKeyMetadata: async (key) => fx.keys[key] || null,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({ getProviderConnectionProviderById: mocks.getProviderConnectionProviderById }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async (k) => fx.keys[k] || null, touchApiKey: vi.fn(async () => {}) }));
vi.mock("@/lib/db/repos/usageRepo", () => ({ getDailyUsageForApiKey: async () => fx.usage }));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: mocks.saveRequestUsage }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  extractApiKey: (request) => {
    const a = request.headers.get("Authorization");
    return a?.startsWith("Bearer ") ? a.slice(7) : request.headers.get("x-api-key");
  },
  isValidApiKey: mocks.isValidApiKey,
  // Upstream's handler now calls this before the fork access gate; return null so
  // the fork gate (real keyAccess.js, driven by fx.keys access) owns the 403s.
  getApiKeyPolicyError: async () => null,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/handlers/ttsCore.js", () => ({ handleTtsCore: mocks.handleTtsCore }));
vi.mock("open-sse/handlers/sttCore.js", () => ({ handleSttCore: mocks.handleSttCore }));
vi.mock("open-sse/handlers/search/index.js", () => ({ handleSearchCore: mocks.handleSearchCore }));
vi.mock("open-sse/handlers/fetch/index.js", () => ({ handleFetchCore: mocks.handleFetchCore }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { handleEmbeddings } = await import("../../src/sse/handlers/embeddings.js");
const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");
const { handleTts } = await import("../../src/sse/handlers/tts.js");
const { handleStt } = await import("../../src/sse/handlers/stt.js");
const { handleVideoCreate, handleVideoGet } = await import("../../src/sse/handlers/videoGeneration.js");
const { handleSearch } = await import("../../src/sse/handlers/search.js");
const { handleFetch } = await import("../../src/sse/handlers/fetch.js");
const { handleSystemone } = await import("../../src/sse/handlers/systemone.js");
const geminiRoute = await import("../../src/app/api/v1beta/models/[...path]/route.js");
const modelsRoute = await import("../../src/app/api/v1/models/route.js");
const modelsKindRoute = await import("../../src/app/api/v1/models/[...model]/route.js");
const modelsInfoRoute = await import("../../src/app/api/v1/models/info/route.js");

const enc = new TextEncoder();
const sse = (frames) => new Response(new ReadableStream({
  start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); },
}), { status: 200, headers: { "Content-Type": "text/event-stream" } });
const ROLE = `data: {"id":"x","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n`;
const CONTENT = (t) => `data: {"id":"x","choices":[{"index":0,"delta":{"content":"${t}"},"finish_reason":null}]}\n\n`;
const DONE = `data: [DONE]\n\n`;

const auth = (k) => (k ? { Authorization: `Bearer ${k}` } : {});
const post = (path, body, k, extra = {}) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...auth(k), ...extra },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  fx.usage = { requests: 0, cost: 0 };
  fx.requireApiKey = false;
  mocks.isValidApiKey.mockImplementation(async (key) => Boolean(fx.keys[key]?.isActive));
  mocks.getProviderConnectionProviderById.mockResolvedValue("xai");
  mocks.getProviderConnectionById.mockImplementation(() => { throw new Error("full connection lookup before policy"); });
  mocks.usageWriteFailure = false;
  mocks.saveRequestUsage.mockImplementation(async (entry) => {
    if (mocks.usageWriteFailure) throw new Error("usage storage unavailable");
    if (entry.apiKey && entry.status === "success") fx.usage.requests += 1;
  });
  fx.keys = {
    "sk-open": { id: "o", name: "open", isActive: true, access: { restricted: false, allow: [] } },
    "sk-combo": { id: "c", name: "combo", isActive: true, access: { restricted: true, allow: ["Main"] } },
    "sk-b": { id: "b", name: "b", isActive: true, access: { restricted: true, allow: ["openai/model-b"] } },
    "sk-empty": { id: "e", name: "empty", isActive: true, access: { restricted: true, allow: [] } },
    "sk-mixed": { id: "mix", name: "mixed", isActive: true, allowedModels: ["openai/model-a"], access: { restricted: true, allow: ["openai/model-b"] } },
    "sk-media": {
      id: "m", name: "media", isActive: true,
      access: {
        restricted: true,
        allow: ["openai/text-embedding-3-small", "openai/dall-e-3", "openai/tts-1", "openai/whisper-1",
          "xai/grok-imagine-video", "tavily", "openai/gpt-4o", "gemini/gemini-2.5-flash-preview-tts"],
      },
    },
  };
  mocks.getProviderCredentials.mockResolvedValue(null);
  mocks.handleTtsCore.mockResolvedValue({ success: true, response: new Response("audio") });
  mocks.handleSttCore.mockResolvedValue({ success: true, response: Response.json({ text: "speech" }) });
  mocks.handleSearchCore.mockResolvedValue({ success: true, response: Response.json({ results: [] }) });
  mocks.handleFetchCore.mockResolvedValue({ success: true, data: { content: "page" } });
  // model-a always fails upstream (500), so a combo of [model-a, model-b] only
  // succeeds by failing over to model-b.
  mocks.handleChatCore.mockImplementation(async ({ modelInfo }) => (modelInfo.model === "model-a"
    ? {
      success: false, status: 500, error: "upstream error",
      response: new Response(JSON.stringify({ error: { message: "upstream error" } }), { status: 500, headers: { "Content-Type": "application/json" } }),
    }
    : { success: true, response: sse([ROLE, CONTENT(`from-${modelInfo.model}`), DONE]) }));
});

const chat = (model, k) => handleChat(post("/v1/chat/completions", { model, stream: true, messages: [{ role: "user", content: "hi" }] }, k));

describe("chat (/v1/chat/completions, /v1/messages, /v1/responses all use handleChat)", () => {
  beforeEach(() => mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn", connectionName: "mock" }));

  it("unrestricted key reaches the provider for the combo and models", async () => {
    for (const m of ["Main", "openai/model-b"]) {
      expect((await chat(m, "sk-open")).status).toBe(200);
    }
    expect((await chat("openai/model-a", "sk-open")).status).toBe(500); // provider error, not a 403
  });
  it("restricted-to-combo key: combo 200, direct member and unlisted model 403 before any credential lookup", async () => {
    expect((await chat("Main", "sk-combo")).status).toBe(200);
    vi.clearAllMocks();
    for (const m of ["openai/model-a", "openai/model-b", "openai/gpt-4o"]) {
      const r = await chat(m, "sk-combo");
      expect(r.status).toBe(403);
    }
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
  it("canonical access overrides conflicting legacy allowedModels", async () => {
    expect((await chat("openai/model-b", "sk-mixed")).status).toBe(200);
    vi.clearAllMocks();
    expect((await chat("openai/model-a", "sk-mixed")).status).toBe(403);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });
  it("restricted-to-model-B key: B 200; the combo containing B and model A are 403", async () => {
    expect((await chat("openai/model-b", "sk-b")).status).toBe(200);
    vi.clearAllMocks();
    // Bypass check: a per-member check would skip the failing model-a and serve
    // the combo from model-b. The combo itself is not listed, so it is a 403.
    expect((await chat("Main", "sk-b")).status).toBe(403);
    expect((await chat("openai/model-a", "sk-b")).status).toBe(403);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
  it("empty-list key: 403 on everything", async () => {
    for (const m of ["Main", "openai/model-a", "openai/model-b"]) expect((await chat(m, "sk-empty")).status).toBe(403);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
  it("restricted key on an allowed combo still fails over from an erroring member to the next", async () => {
    const r = await chat("Main", "sk-combo");
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("from-model-b");
    const tried = mocks.handleChatCore.mock.calls.map(([a]) => a.modelInfo.model);
    expect(tried).toEqual(["model-a", "model-b"]);
  });
  it("bypass check: a restricted key sent as x-goog-api-key on the Gemini-compatible route is still restricted", async () => {
    const res = await geminiRoute.POST(
      new Request("http://localhost/v1beta/models/openai/model-a:generateContent", {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": "sk-b" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
      }),
      { params: Promise.resolve({ path: ["openai", "model-a:generateContent"] }) },
    );
    expect(res.status).toBe(403);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
});

// Each non-chat handler: [name, call(model, key), allowedModel, deniedModel]
const handlers = [
  ["embeddings", (m, k) => handleEmbeddings(post("/v1/embeddings", { model: m, input: "x" }, k)), "openai/text-embedding-3-small", "openai/text-embedding-3-large"],
  ["image", (m, k) => handleImageGeneration(post("/v1/images/generations", { model: m, prompt: "x" }, k)), "openai/dall-e-3", "openai/gpt-image-1"],
  ["tts", (m, k) => handleTts(post("/v1/audio/speech", { model: m, input: "x" }, k)), "openai/tts-1", "openai/tts-1-hd"],
  ["stt", (m, k) => {
    const fd = new FormData();
    fd.set("model", m);
    fd.set("file", new Blob([new Uint8Array(4)], { type: "audio/wav" }), "a.wav");
    return handleStt(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", headers: auth(k), body: fd }));
  }, "openai/whisper-1", "groq/whisper-large-v3"],
  ["video", (m, k) => handleVideoCreate(post("/v1/videos/generations", { model: m, prompt: "x" }, k), "generations"), "xai/grok-imagine-video", "xai/grok-imagine-video-pro"],
  ["search", (m, k) => handleSearch(post("/v1/search", { model: m, query: "x" }, k)), "tavily", "exa"],
  ["fetch", (m, k) => handleFetch(post("/v1/web/fetch", { model: m, url: "https://example.com" }, k)), "tavily", "firecrawl"],
  ["systemone", (m, k) => handleSystemone(post("/v1/systemone", { model: m, state: {}, questions: { q: "?" } }, k)), "openai/gpt-4o", "openai/gpt-4.1"],
  ["gemini-native-tts", (m, k) => geminiRoute.POST(
    new Request(`http://localhost/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", ...auth(k) },
      body: JSON.stringify({ contents: [{ parts: [{ text: "x" }] }], generationConfig: { responseModalities: ["AUDIO"] } }),
    }),
    { params: Promise.resolve({ path: [`${m}:generateContent`] }) },
  ), "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"],
];

describe.each(handlers)("%s handler is wired", (_name, call, allowed, denied) => {
  it("denies an unlisted model with 403 before any credential lookup", async () => {
    const r = await call(denied, "sk-media");
    expect(r.status).toBe(403);
    expect((await r.json()).error.message).toContain(denied);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });
  it("lets a listed model through to the credential lookup", async () => {
    const r = await call(allowed, "sk-media");
    expect(r.status).not.toBe(403);
    expect(mocks.getProviderCredentials).toHaveBeenCalled();
  });
  it("leaves an unrestricted key alone", async () => {
    const r = await call(denied, "sk-open");
    expect(r.status).not.toBe(403);
  });
  it("denies everything for the empty-list key", async () => {
    expect((await call(allowed, "sk-empty")).status).toBe(403);
  });
  it("rejects expired unrestricted keys before provider credentials", async () => {
    fx.keys["sk-open"].expiresAt = "2020-01-01T00:00:00.000Z";
    expect((await call(allowed, "sk-open")).status).toBe(401);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });
});

describe("speech accounting", () => {
  it.each([["TTS", () => handleTts(post("/v1/audio/speech", { model: "openai/tts-1", input: "hello" }, "sk-open"))], ["STT", () => {
    const form = new FormData();
    form.set("model", "openai/whisper-1");
    form.set("file", new Blob(["audio"], { type: "audio/wav" }), "audio.wav");
    return handleStt(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", headers: auth("sk-open"), body: form }));
  }]])("returns 503 rather than an upstream success if keyed %s usage cannot be saved", async (_label, call) => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "speech-1", connectionName: "speech" });
    mocks.usageWriteFailure = true;
    const response = await call();
    expect(response.status).toBe(503);
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
  });
  const tts = (key) => handleTts(post("/v1/audio/speech", { model: "openai/tts-1", input: "hello" }, key));
  const stt = (key) => {
    const form = new FormData();
    form.set("model", "openai/whisper-1");
    form.set("file", new Blob(["audio"], { type: "audio/wav" }), "audio.wav");
    return handleStt(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", headers: auth(key), body: form }));
  };
  it.each([["TTS", tts, mocks.handleTtsCore], ["STT", stt, mocks.handleSttCore]])("counts one successful keyed %s request, not failed or anonymous requests", async (_label, call, core) => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "speech-1", connectionName: "speech" });
    expect((await call("sk-open")).status).toBe(200);
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-open", connectionId: "speech-1", status: "success" }));
    mocks.saveRequestUsage.mockClear();
    core.mockResolvedValueOnce({ success: false, status: 500, error: "upstream failed" });
    expect((await call("sk-open")).status).toBe(500);
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    expect((await call(null)).status).toBe(200);
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });
});

describe("search accounting", () => {
  const call = (key) => handleSearch(post("/v1/search", { provider: "tavily", query: "hello" }, key));
  it("stops at the daily cap after one successful request", async () => {
    fx.keys["sk-open"].maxRequestsPerDay = 1;
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "search-1", connectionName: "search" });
    expect((await call("sk-open")).status).toBe(200);
    expect((await call("sk-open")).status).toBe(429);
    expect(mocks.handleSearchCore).toHaveBeenCalledTimes(1);
  });
  it("counts one successful keyed request, but not a failed or anonymous request", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "search-1", connectionName: "search" });
    expect((await call("sk-open")).status).toBe(200);
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-open", provider: "tavily", connectionId: "search-1", status: "success" }));
    mocks.saveRequestUsage.mockClear();
    mocks.handleSearchCore.mockResolvedValueOnce({ success: false, status: 500, error: "upstream failed", response: Response.json({ error: "upstream failed" }, { status: 500 }) });
    expect((await call("sk-open")).status).toBe(500);
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    expect((await call(null)).status).toBe(200);
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });
});

describe("fetch accounting", () => {
  it("counts one successful keyed request, but not an upstream failure", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "fetch-1", connectionName: "fetch" });
    const call = (key) => handleFetch(post("/v1/web/fetch", { provider: "tavily", url: "https://1.1.1.1" }, key));
    expect((await call("sk-open")).status).toBe(200);
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-open", provider: "tavily", connectionId: "fetch-1", status: "success" }));
    mocks.saveRequestUsage.mockClear();
    mocks.handleFetchCore.mockResolvedValueOnce({ success: false, status: 500, error: "upstream failed" });
    expect((await call("sk-open")).status).toBe(500);
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });
});

describe("Gemini-native policy", () => {
  const call = (key) => geminiRoute.POST(
    new Request("http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:generateContent", {
      method: "POST", headers: { "Content-Type": "application/json", ...auth(key) },
      body: JSON.stringify({ contents: [{ parts: [{ text: "x" }] }], generationConfig: { responseModalities: ["AUDIO"] } }),
    }),
    { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:generateContent"] }) },
  );

  const callWithHeaders = (headers, query = "") => geminiRoute.POST(
    new Request(`http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:generateContent${query}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }),
    }),
    { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:generateContent"] }) },
  );

  it("accepts x-api-key as the sole header when API keys are required", async () => {
    fx.requireApiKey = true;
    mocks.getProviderCredentials.mockResolvedValue(null);
    const response = await callWithHeaders({ "x-api-key": "sk-open" });
    expect(response.status).not.toBe(401);
    expect(mocks.isValidApiKey).toHaveBeenCalledWith("sk-open");
    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(1);
  });

  it("uses canonical Bearer then x-api-key precedence for authentication and policy", async () => {
    fx.requireApiKey = true;
    const bearer = await callWithHeaders({ Authorization: "Bearer sk-empty", "x-api-key": "sk-open", "x-goog-api-key": "sk-open" });
    expect(bearer.status).toBe(403);
    expect(mocks.isValidApiKey).toHaveBeenLastCalledWith("sk-empty");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    const xApiKey = await callWithHeaders({ "x-api-key": "sk-empty", "x-goog-api-key": "sk-open" });
    expect(xApiKey.status).toBe(403);
    expect(mocks.isValidApiKey).toHaveBeenLastCalledWith("sk-empty");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("prefers x-goog-api-key over query key when no higher header is present", async () => {
    fx.requireApiKey = true;
    const response = await callWithHeaders({ "x-goog-api-key": "sk-empty" }, "?key=sk-open");
    expect(response.status).toBe(403);
    expect(mocks.isValidApiKey).toHaveBeenCalledWith("sk-empty");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("rejects the highest-precedence invalid key before credentials despite a valid lower-priority header", async () => {
    fx.requireApiKey = true;
    const response = await callWithHeaders({ Authorization: "Bearer invalid-key", "x-api-key": "sk-open" });
    expect(response.status).toBe(401);
    expect(mocks.isValidApiKey).toHaveBeenCalledWith("invalid-key");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("blocks expired unrestricted keys before credentials", async () => {
    fx.keys["sk-open"].expiresAt = "2020-01-01T00:00:00.000Z";
    expect((await call("sk-open")).status).toBe(401);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });
  it("returns 503 before committing a non-stream Gemini response when usage persistence fails", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
    mocks.usageWriteFailure = true;
    try {
      expect((await call("sk-open")).status).toBe(503);
      expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps a committed Gemini stream intact when its usage write fails", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    const bytes = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n';
    globalThis.fetch = vi.fn(async () => new Response(bytes, { headers: { "content-type": "text/event-stream" } }));
    mocks.usageWriteFailure = true;
    try {
      const response = await geminiRoute.POST(new Request(
        "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
        { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
      ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(bytes);
      expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("counts successful requests through the usage pathway until the daily cap is reached", async () => {
    fx.keys["sk-open"].maxRequestsPerDay = 2;
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({
      candidates: [{ content: { parts: [{ text: "the word error is ordinary text" }] } }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
    }));
    try {
      expect((await call("sk-open")).status).toBe(200);
      expect((await call("sk-open")).status).toBe(200);
      expect(fx.usage.requests).toBe(2);
      expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: "sk-open", provider: "gemini", model: "gemini-2.5-flash-preview-tts",
        tokens: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }, status: "success",
      }));
      expect((await call("sk-open")).status).toBe(429);
      expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("records streamed usage only after the successful response is consumed", async () => {
    fx.keys["sk-open"].maxRequestsPerDay = 1;
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"ordinary error text"}]}}]}\n\ndata: {"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":1,"totalTokenCount":3}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    ));
    const stream = () => geminiRoute.POST(new Request(
      "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
      { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
    ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
    try {
      const response = await stream();
      expect(response.status).toBe(200);
      await response.text();
      expect(fx.usage.requests).toBe(1);
      expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
        tokens: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      }));
      expect((await stream()).status).toBe(429);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it.each([
    ["usage-only", { usageMetadata: { promptTokenCount: 2, totalTokenCount: 2 } }],
    ["empty candidates", { candidates: [] }],
    ["finish-only candidate", { candidates: [{ finishReason: "STOP" }] }],
  ])("records one standalone %s Gemini success", async (_kind, payload) => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json(payload));
    try {
      expect((await (await call("sk-open")).json())).toEqual(payload);
      expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
      expect(fx.usage.requests).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count a structured Gemini error in an HTTP-200 JSON response", async () => {
    fx.keys["sk-open"].maxRequestsPerDay = 1;
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({ error: { code: 429, message: "quota exceeded", status: "RESOURCE_EXHAUSTED" } }));
    try {
      for (let i = 0; i < 2; i++) {
        const response = await call("sk-open");
        expect(response.status).toBe(200);
        expect((await response.json()).error.status).toBe("RESOURCE_EXHAUSTED");
      }
      expect(fx.usage.requests).toBe(0);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count an HTTP-200 JSON error when the requested action is streaming", async () => {
    fx.keys["sk-open"].maxRequestsPerDay = 1;
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({ error: { code: 429, message: "quota exceeded" } }));
    const stream = () => geminiRoute.POST(new Request(
      "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
      { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
    ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
    try {
      for (let i = 0; i < 2; i++) {
        const response = await stream();
        expect((await response.json()).error.code).toBe(429);
      }
      expect(fx.usage.requests).toBe(0);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count a structured Gemini error SSE frame at clean EOF", async () => {
    fx.keys["sk-open"].maxRequestsPerDay = 1;
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"the word error is ordinary text"}]}}]}\n\n'
      + 'data: {"error":{"code":429,\n'
      + 'data: "message":"quota exceeded","status":"RESOURCE_EXHAUSTED"}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    ));
    const stream = () => geminiRoute.POST(new Request(
      "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
      { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
    ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
    try {
      for (let i = 0; i < 2; i++) {
        const response = await stream();
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("RESOURCE_EXHAUSTED");
      }
      expect(fx.usage.requests).toBe(0);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count CRLF-delimited Gemini error events", async () => {
    fx.keys["sk-open"].maxRequestsPerDay = 1;
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(
      'data: {"error":{"code":429,"message":"quota exceeded"}}\r\n\r\n',
      { headers: { "content-type": "text/event-stream" } },
    ));
    try {
      const response = await geminiRoute.POST(new Request(
        "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
        { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
      ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
      expect(await response.text()).toContain("quota exceeded");
      expect(fx.usage.requests).toBe(0);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count malformed or unclassifiable HTTP-200 JSON", async () => {
    fx.keys["sk-open"].maxRequestsPerDay = 1;
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(async () => new Response("not-json", { headers: { "content-type": "application/json" } }))
      .mockImplementationOnce(async () => Response.json({ message: "error is ordinary text" }));
    try {
      expect(await (await call("sk-open")).text()).toBe("not-json");
      expect((await (await call("sk-open")).json()).message).toBe("error is ordinary text");
      expect(fx.usage.requests).toBe(0);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("forwards but does not count an unterminated SSE success event", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    const bytes = 'data: {"candidates":[]}\n';
    globalThis.fetch = vi.fn(async () => new Response(bytes, { headers: { "content-type": "text/event-stream" } }));
    try {
      const response = await geminiRoute.POST(new Request(
        "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
        { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
      ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
      expect(await response.text()).toBe(bytes);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("forwards but does not count a completed success followed by unterminated SSE data", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    const bytes = 'data: {"candidates":[]}\n\ndata: {"error":{"code":429';
    globalThis.fetch = vi.fn(async () => new Response(bytes, { headers: { "content-type": "text/event-stream" } }));
    try {
      const response = await geminiRoute.POST(new Request(
        "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
        { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
      ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
      expect(await response.text()).toBe(bytes);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("records a valid CR-only SSE success event", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    const bytes = 'data: {"candidates":[{"content":{"parts":[{"text":"ordinary error text"}]}}]}\r\r';
    globalThis.fetch = vi.fn(async () => new Response(bytes, { headers: { "content-type": "text/event-stream" } }));
    try {
      const response = await geminiRoute.POST(new Request(
        "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
        { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
      ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
      expect(await response.text()).toBe(bytes);
      expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count an SSE stream with no classifiable event", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('data: {not-json}\n\n', { headers: { "content-type": "text/event-stream" } }));
    try {
      const response = await geminiRoute.POST(new Request(
        "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
        { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
      ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
      expect(await response.text()).toContain("not-json");
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("rejects malformed candidate arrays even alongside valid usage", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({
      candidates: [null, 123], usageMetadata: { promptTokenCount: 2, totalTokenCount: 2 },
    }));
    try {
      const response = await call("sk-open");
      expect((await response.json()).candidates).toEqual([null, 123]);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count malformed candidate content even with a finish reason in JSON", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    const payload = { candidates: [{ content: { parts: [123] }, finishReason: "STOP" }] };
    globalThis.fetch = vi.fn(async () => Response.json(payload));
    try {
      expect((await (await call("sk-open")).json()).candidates).toEqual(payload.candidates);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count malformed candidate content even with a finish reason in complete SSE", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    const bytes = 'data: {"candidates":[{"content":{"parts":[123]},"finishReason":"STOP"}]}\n\n';
    globalThis.fetch = vi.fn(async () => new Response(bytes, { headers: { "content-type": "text/event-stream" } }));
    try {
      const response = await geminiRoute.POST(new Request(
        "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
        { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
      ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
      expect(await response.text()).toBe(bytes);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count malformed candidate arrays inside a complete SSE event", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    const bytes = 'data: {"candidates":[123],"usageMetadata":{"promptTokenCount":2}}\n\n';
    globalThis.fetch = vi.fn(async () => new Response(bytes, { headers: { "content-type": "text/event-stream" } }));
    try {
      const response = await geminiRoute.POST(new Request(
        "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
        { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
      ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
      expect(await response.text()).toBe(bytes);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count a stream reader exception or cancellation during a pending read", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    let releaseRead;
    let signalPending;
    const pendingRead = new Promise((resolve) => { releaseRead = resolve; });
    const readStarted = new Promise((resolve) => { signalPending = resolve; });
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(async () => new Response(new ReadableStream({
        start(controller) { controller.error(new Error("read failed")); },
      }), { headers: { "content-type": "text/event-stream" } }))
      .mockImplementationOnce(async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('data: {"candidates":[]}\n\n')); },
        async pull(controller) { signalPending(); await pendingRead; controller.close(); },
        cancel() { releaseRead(); },
      }), { headers: { "content-type": "text/event-stream" } }));
    const stream = () => geminiRoute.POST(new Request(
      "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
      { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
    ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
    try {
      const failed = await stream();
      await expect(failed.text()).rejects.toThrow("read failed");
      const cancelled = await stream();
      const reader = cancelled.body.getReader();
      await reader.read();
      await readStarted;
      await reader.cancel();
      releaseRead();
      await pendingRead;
      await Promise.resolve();
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      releaseRead?.();
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count an empty SSE response", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("", { headers: { "content-type": "text/event-stream" } }));
    try {
      const response = await geminiRoute.POST(new Request(
        "http://localhost/v1beta/models/gemini-2.5-flash-preview-tts:streamGenerateContent",
        { method: "POST", headers: { "Content-Type": "application/json", ...auth("sk-open") }, body: JSON.stringify({ generationConfig: { responseModalities: ["AUDIO"] } }) },
      ), { params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:streamGenerateContent"] }) });
      expect(await response.text()).toBe("");
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("does not count failed upstream responses", async () => {
    fx.keys["sk-open"].maxRequestsPerDay = 1;
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "gemini-1", apiKey: "upstream-key" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({ error: "upstream failed" }, { status: 400 }));
    try {
      expect((await call("sk-open")).status).toBe(400);
      expect(fx.usage.requests).toBe(0);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("video polling access", () => {
  const poll = (key, provider = "xai", headers = {}) => handleVideoGet(new Request(
    `http://localhost/v1/videos/job-1?provider=${provider}`, { headers: { ...auth(key), ...headers } },
  ), "job-1");

  it.each([
    ["empty list", "sk-empty"],
    ["narrow exact model", "sk-media"],
    ["narrow model glob", "sk-model-glob"],
    ["other provider", "sk-other-provider"],
  ])("denies %s before credentials or upstream video fetch", async (_label, key) => {
    fx.keys["sk-model-glob"] = { id: "vg", name: "video-glob", access: { restricted: true, allow: ["xai/grok-imagine*"] } };
    fx.keys["sk-other-provider"] = { id: "vp", name: "other-provider", access: { restricted: true, allow: ["gemini/*"] } };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    try {
      expect((await poll(key)).status).toBe(403);
      expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(mocks.getProviderConnectionById).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("denies a pinned poll using only provider metadata before any full connection or credential lookup", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    try {
      expect((await poll("sk-empty", "gemini", { "x-connection-id": "conn-xai" })).status).toBe(403);
      expect(mocks.getProviderConnectionProviderById).toHaveBeenCalledWith("conn-xai");
      expect(mocks.getProviderConnectionById).not.toHaveBeenCalled();
      expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("denies a mismatched pinned provider before credential lookup", async () => {
    fx.keys["sk-provider-wide"] = { id: "pw", name: "provider-wide", access: { restricted: true, allow: ["gemini/*"] } };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    try {
      expect((await poll("sk-provider-wide", "gemini", { "x-connection-id": "conn-xai" })).status).toBe(403);
      expect(mocks.getProviderConnectionProviderById).toHaveBeenCalledWith("conn-xai");
      expect(mocks.getProviderConnectionById).not.toHaveBeenCalled();
      expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects expired and capped pinned polls before provider metadata or credentials", async () => {
    fx.keys["sk-open"].expiresAt = "2020-01-01T00:00:00.000Z";
    expect((await poll("sk-open", "xai", { "x-connection-id": "conn-xai" })).status).toBe(401);
    fx.keys["sk-open"].expiresAt = null;
    fx.keys["sk-open"].maxRequestsPerDay = 1;
    fx.usage.requests = 1;
    expect((await poll("sk-open", "xai", { "x-connection-id": "conn-xai" })).status).toBe(429);
    expect(mocks.getProviderConnectionProviderById).not.toHaveBeenCalled();
    expect(mocks.getProviderConnectionById).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("does not count a failed upstream poll", async () => {
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn-xai", accessToken: "upstream-token" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({ error: "upstream failed" }, { status: 500 }));
    try {
      expect((await poll("sk-open")).status).toBe(500);
      expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("counts a successful keyed poll once and rejects the next poll at its cap", async () => {
    fx.keys["sk-open"].maxRequestsPerDay = 1;
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn-xai", accessToken: "upstream-token" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({ status: "pending" }));
    try {
      expect((await poll("sk-open")).status).toBe(200);
      expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
      expect(fx.usage.requests).toBe(1);
      expect((await poll("sk-open")).status).toBe(429);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each(["xai/*", "xai"])("allows provider-wide %s through to poll", async (allow) => {
    fx.keys["sk-provider-wide"] = { id: "pw", name: "provider-wide", access: { restricted: true, allow: [allow] } };
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn-xai", accessToken: "upstream-token" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({ status: "pending" }));
    try {
      const response = await poll("sk-provider-wide");
      expect(response.status).toBe(200);
      expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
      expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: "sk-provider-wide", provider: "xai", connectionId: "conn-xai", status: "success",
      }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("video: a body without a readable model is denied for restricted keys", () => {
  it("multipart / no model -> 403 for restricted, untouched for unrestricted", async () => {
    const noModel = (k) => handleVideoCreate(post("/v1/videos/generations", { prompt: "x" }, k), "generations");
    expect((await noModel("sk-media")).status).toBe(403);
    expect((await noModel("sk-open")).status).not.toBe(403);
  });
});

describe("/v1/models routes filter by key", () => {
  const info = (id, key) => modelsInfoRoute.GET(new Request(`http://localhost/v1/models/info?id=${encodeURIComponent(id)}`, { headers: auth(key) }));
  const list = async (k) => (await (await modelsRoute.GET(new Request("http://localhost/v1/models", { headers: auth(k) }))).json()).data.map((m) => m.id);

  it("single-model metadata obeys expiry, caps, and canonical visibility", async () => {
    expect((await info("openai/tts-1", "sk-media")).status).toBe(200);
    expect((await info("openai/tts-1", "sk-empty")).status).toBe(404);
    expect((await info("tavily/search", "sk-media")).status).toBe(200);
    expect((await info("tavily/search", "sk-empty")).status).toBe(404);
    fx.keys["sk-media"].expiresAt = "2020-01-01T00:00:00.000Z";
    expect((await info("openai/tts-1", "sk-media")).status).toBe(401);
    fx.keys["sk-media"].expiresAt = null;
    fx.keys["sk-media"].maxRequestsPerDay = 1;
    fx.usage.requests = 1;
    expect((await info("openai/tts-1", "sk-media")).status).toBe(429);
  });

  it("unrestricted sees the full catalog; restricted keys see only their entries", async () => {
    const all = await list("sk-open");
    expect(all).toContain("Main");
    const someModel = all.find((id) => id.startsWith("openai/"));
    expect(someModel).toBeTruthy();
    fx.keys["sk-mix"] = { id: "x", name: "mix", isActive: true, access: { restricted: true, allow: ["Main", someModel.toUpperCase()] } };
    expect(await list("sk-mix")).toEqual(["Main", someModel]);
    expect(await list("sk-combo")).toEqual(["Main"]);
    expect(await list("sk-empty")).toEqual([]);
    expect(await list(null)).toEqual(all); // no key: unchanged (middleware governs remote access)
  });
  it("discovery ignores conflicting legacy allow entries in favor of canonical access", async () => {
    const all = await list("sk-open");
    const allowed = all.find((id) => id.startsWith("openai/"));
    const denied = all.find((id) => id.startsWith("openai/") && id !== allowed);
    expect(allowed).toBeTruthy();
    expect(denied).toBeTruthy();
    fx.keys["sk-mixed"].access.allow = [allowed];
    fx.keys["sk-mixed"].allowedModels = [denied];
    expect(await list("sk-mixed")).toContain(allowed);
    expect(await list("sk-mixed")).not.toContain(denied);
    const lookup = (id) => modelsKindRoute.GET(new Request(`http://localhost/v1/models/${id}`, { headers: auth("sk-mixed") }), { params: Promise.resolve({ model: id.split("/") }) });
    expect((await lookup(allowed)).status).toBe(200);
    expect((await lookup(denied)).status).toBe(404);
    const kind = modelsKindRoute.GET(new Request("http://localhost/v1/models/embedding", { headers: auth("sk-mixed") }), { params: Promise.resolve({ model: ["embedding"] }) });
    expect((await (await kind).json()).data).toEqual([]);
  });
  it("/v1/models/{kind} and single-model lookup are filtered too", async () => {
    const kind = async (k, path) => modelsKindRoute.GET(new Request(`http://localhost/v1/models/${path.join("/")}`, { headers: auth(k) }), { params: Promise.resolve({ model: path }) });
    const emb = await (await kind("sk-open", ["embedding"])).json();
    expect(emb.data.length).toBeGreaterThan(0);
    expect((await (await kind("sk-empty", ["embedding"])).json()).data).toEqual([]);
    const all = (await (await modelsRoute.GET(new Request("http://localhost/v1/models"))).json()).data;
    const one = all.find((m) => m.owned_by !== "combo").id;
    expect((await kind("sk-open", one.split("/"))).status).toBe(200);
    expect((await kind("sk-empty", one.split("/"))).status).toBe(404);
  });
});
