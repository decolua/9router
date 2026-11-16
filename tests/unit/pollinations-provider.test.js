import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...await importOriginal(), proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import provider from "../../open-sse/providers/registry/pollinations.js";
import { clearPollinationsCatalog, parsePollinationsModels, pollinationsHeaders, resolvePollinationsModels, validatePollinationsKey } from "../../open-sse/services/pollinationsModels.js";
import embedding from "../../open-sse/handlers/embeddingProviders/pollinations.js";
import image from "../../open-sse/handlers/imageProviders/pollinations.js";
import speech, { fetchPollinationsVoices } from "../../open-sse/handlers/ttsProviders/pollinations.js";
import video from "../../open-sse/handlers/videoProviders/pollinations.js";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { handleVideoProxyCore } from "../../open-sse/handlers/videoCore.js";
import { handleSystemoneCore } from "../../open-sse/handlers/systemoneCore.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const credentials = { apiKey: "sk_test" };
const id = "a".repeat(64);
const mediaUrl = "https://media.pollinations.ai/video-test";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const clip = () => new Response(new Uint8Array([0, 1, 2]), { headers: { "content-type": "video/mp4", link: `<${mediaUrl}>; rel="enclosure"` } });
function row(category, endpoint, extra = {}) {
  return { id: `publisher/${category}`, title: `${category} model`, category, paid_only: false, supported_endpoints: [endpoint], input_modalities: ["text"], output_modalities: [category], ...extra };
}
const catalog = { data: [
  row("text", "/v1/chat/completions", { aliases: ["legacy"], capabilities: ["tool_calling", "reasoning"], supported_parameters: ["response_format"], input_modalities: ["text", "image", "audio", "video"], pricing: { promptTextTokens: "0.000001" }, context_length: 128000 }),
  row("embedding", "/v1/embeddings"), row("image", "/v1/images/generations"),
  row("audio", "/v1/audio/speech", { id: "publisher/speech", voices: ["alloy", "nova"] }),
  row("audio", "/v1/audio/transcriptions", { id: "publisher/transcribe" }),
  row("video", "/video/{prompt}", { max_duration: 8, allowed_durations: [4, 6, 8], video_capabilities: { first_frame: true } }),
  row("decision", "/alpha/decisions"), row("realtime", "/v1/realtime", { input_modalities: ["audio", "image"], output_modalities: ["audio", "text"] }),
  row("text", "/v1/chat/completions", { id: "paid/model", paid_only: true, pricing: { promptTextTokens: "0" } }),
  row("3d", "/3d/{prompt}"),
] };

beforeEach(() => { clearPollinationsCatalog(); vi.stubGlobal("fetch", vi.fn()); proxyAwareFetch.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Pollinations catalog and authentication", () => {
  it("registers an authenticated free tier with OpenAI chat transport, no stale model fallback and honest pricing notice", () => {
    expect(provider).toMatchObject({ category: "freeTier", hasFree: true, authType: "apikey", alias: "pollinations", models: [], transport: { thinkingFormat: "openai" } });
    expect(provider.transport.baseUrl).toBe("https://gen.pollinations.ai/v1/chat/completions");
    expect(provider.display.notice.text).toMatch(/real Pollen/);
    expect(provider.serviceKinds).toContain("embedding");
    expect(provider.realtimeUrl).toBe("wss://gen.pollinations.ai/v1/realtime");
  });
  it("normalizes all local overlaps and preserves canonical IDs, aliases, capabilities and limits", () => {
    const models = parsePollinationsModels(catalog);
    expect(models.map((model) => model.kind)).toEqual(["llm", "embedding", "image", "tts", "stt", "video", "systemone", "realtime"]);
    expect(models[0]).toMatchObject({ id: "publisher/text", aliases: ["legacy"], contextLength: 128000, capabilities: { vision: true, audioInput: true, videoInput: true, tools: true, reasoning: true, structuredOutputs: true, streaming: true } });
    expect(models[5]).toMatchObject({ max_duration: 8, allowed_durations: [4, 6, 8] });
    expect(models.find((model) => model.id === "paid/model")).toBeUndefined();
    expect(parsePollinationsModels({ data: [row("text", "/v1/chat/completions", { paid_only: undefined })] })).toEqual([]);
    expect(models[7]).toMatchObject({ kind: "realtime", capabilities: { vision: true, audioInput: true, audioOutput: true }, supported_endpoints: ["/v1/realtime"] });
  });
  it("validates against account/key, not the public catalog, with the resolved proxy", async () => {
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid" };
    proxyAwareFetch.mockResolvedValueOnce(json({ valid: true, type: "secret" }));
    await expect(validatePollinationsKey(credentials, { proxyOptions })).resolves.toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith("https://gen.pollinations.ai/account/key", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer sk_test" }) }), proxyOptions);
    expect(() => pollinationsHeaders({ apiKey: "pk_app" })).toThrow(/secret sk_/);
    proxyAwareFetch.mockResolvedValueOnce(json({ valid: false, type: "secret" }));
    await expect(validatePollinationsKey(credentials)).rejects.toMatchObject({ status: 401 });
  });
  it("automatically includes zero-charge pricing but not missing or invalid prices", async () => {
    proxyAwareFetch.mockResolvedValueOnce(json({ data: [
      row("text", "/v1/chat/completions", { id: "free", pricing: { currency: "pollen", input: "0", output: 0 } }),
      row("text", "/v1/chat/completions", { id: "stealth/glyph-cluster", pricing: { currency: "pollen" } }),
      row("text", "/v1/chat/completions", { id: "quest", pricing: { currency: "pollen", input: "0", output: "0.001" } }),
      row("text", "/v1/chat/completions", { id: "unknown" }),
      row("text", "/v1/chat/completions", { id: "invalid", pricing: { currency: "pollen", input: null } }),
    ] }));
    const result = await resolvePollinationsModels(credentials);
    expect(result.models.map(model => model.id)).toEqual(["free", "stealth/glyph-cluster"]);
    expect(result.suggestedModels.map(model => model.id)).toEqual(["quest", "unknown", "invalid"]);
  });
  it("caches for five minutes without crossing credential/proxy boundaries and exposes upstream failures", async () => {
    proxyAwareFetch.mockImplementation(async () => json(catalog));
    await resolvePollinationsModels(credentials);
    await resolvePollinationsModels(credentials);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    await resolvePollinationsModels({ apiKey: "sk_other" });
    await resolvePollinationsModels(credentials, { proxyOptions: { strictProxy: true } });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
    proxyAwareFetch.mockResolvedValueOnce(json({ error: { message: "Denied" } }, 403));
    await expect(resolvePollinationsModels(credentials, { forceRefresh: true })).rejects.toMatchObject({ status: 403, message: "Denied" });
  });
  it("allows public discovery and returns an authoritative empty catalog", async () => {
    proxyAwareFetch.mockResolvedValueOnce(json({ data: [] }));
    expect((await resolvePollinationsModels()).models).toEqual([]);
    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

describe("Pollinations OpenAI media", () => {
  it("passes multimodal embeddings and retrieval options through the core", async () => {
    const input = [{ type: "text", text: "cat" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }];
    fetch.mockResolvedValueOnce(json({ object: "list", data: [{ embedding: [1, 2] }], usage: { prompt_tokens: 4, total_tokens: 4 } }));
    const result = await handleEmbeddingsCore({ body: { input, input_type: "document", dimensions: 256, encoding_format: "base64" }, modelInfo: { provider: "pollinations", model: "cohere/embed-v4.0" }, credentials });
    expect(result.success).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ model: "cohere/embed-v4.0", input, input_type: "document", dimensions: 256, encoding_format: "base64" });
    expect(() => embedding.buildBody("x", { input: Array(33).fill("x") })).toThrow(/32/);
    expect(() => embedding.buildBody("x", { input: { type: "image_url", image_url: {} } })).toThrow(/content part/);
  });
  it("chooses edits for source images and preserves all generation controls", async () => {
    const body = { prompt: "change sky", images: ["https://example.org/a.png", "data:image/png;base64,AA=="], size: "auto", seed: 42, response_format: "url" };
    expect(image.buildUrl("model", credentials, body)).toBe("https://gen.pollinations.ai/v1/images/edits");
    fetch.mockResolvedValueOnce(json({ created: 1, data: [{ url: mediaUrl }] }));
    const result = await handleImageGenerationCore({ body, modelInfo: { provider: "pollinations", model: "microsoft/mai-image-2.6" }, credentials });
    expect(result.success).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ model: "microsoft/mai-image-2.6", image: [{ image_url: body.images[0] }, { image_url: body.images[1] }], size: "auto", seed: 42 });
    expect(image.buildUrl("model", credentials, { prompt: "cat" })).toMatch(/generations$/);
    expect(() => image.buildBody("model", { prompt: "cat", n: 2 })).toThrow(/one image/);
  });
  it("handles canonical model/voice IDs, proxy options, style and requested audio codecs", async () => {
    const proxyOptions = { strictProxy: true };
    proxyAwareFetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/wav" } }));
    const result = await speech.synthesize("hello", "community/owner/speech/nova", credentials, "wav", { style: "cheerful", proxyOptions });
    expect(result.format).toBe("wav");
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body)).toMatchObject({ model: "community/owner/speech", voice: "nova", response_format: "wav", instructions: "cheerful" });
    expect(proxyAwareFetch.mock.calls[0][2]).toEqual(proxyOptions);
    proxyAwareFetch.mockResolvedValueOnce(json(catalog));
    expect((await fetchPollinationsVoices("sk_test")).map((voice) => voice.voice_id)).toEqual(["publisher/speech/alloy", "publisher/speech/nova"]);
  });
  it("forwards native typed decisions through the System One endpoint", async () => {
    fetch.mockResolvedValueOnce(json({ answers: { valid: { type: "noul", noul: 0.8 } }, usage: { input_tokens: 2, output_tokens: 1 } }));
    const result = await handleSystemoneCore({ body: { state: "facts", questions: { valid: { type: "noul", instructions: "valid?" } } }, modelInfo: { provider: "pollinations", model: "publisher/decision" }, credentials });
    expect(result.success).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe("https://gen.pollinations.ai/v1/systemone");
    expect((await result.response.json()).answers.valid.noul).toBe(0.8);
  });
  it("uses generic OpenAI transcription without losing canonical model IDs", async () => {
    const formData = new FormData();
    formData.set("file", new Blob(["audio"], { type: "audio/wav" }), "clip.wav");
    formData.set("language", "en");
    proxyAwareFetch.mockResolvedValueOnce(json({ text: "hello" }));
    const result = await handleSttCore({ provider: "pollinations", model: "openai/whisper-large-v3", formData, credentials, sttConfig: provider.sttConfig });
    expect(result.success).toBe(true);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(provider.sttConfig.baseUrl);
    expect(proxyAwareFetch.mock.calls[0][1].body.get("model")).toBe("openai/whisper-large-v3");
  });
  it("keeps OpenAI tool, vision, stream and structured-output payloads on the generic executor", async () => {
    const executor = getExecutor("pollinations");
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.org/a.png" } }] }], tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }], response_format: { type: "json_schema", json_schema: { name: "answer", schema: { type: "object" } } }, reasoning_effort: "high" };
    body.model = "publisher/text";
    body.stream = true;
    const event = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"lookup","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n';
    proxyAwareFetch.mockResolvedValueOnce(new Response(event, { headers: { "content-type": "text/event-stream" } }));
    const result = await executor.execute({ model: "publisher/text", body, stream: true, credentials });
    expect(result.transformedBody).toMatchObject({ model: "publisher/text", stream: true, tools: body.tools, messages: body.messages, response_format: body.response_format, reasoning_effort: "high" });
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(provider.transport.baseUrl);
    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer sk_test");
    expect(await result.response.text()).toBe(event);
  });
});

describe("Pollinations video jobs", () => {
  it("submits async native video generation with first/last-frame and reference controls", () => {
    const plan = video.buildRequest({ action: "generations", credentials, contentType: "application/json", rawBody: JSON.stringify({ model: "publisher/video", prompt: "a/b?", duration: 4, aspect_ratio: "16:9", image: ["https://example.org/start", "https://example.org/end"], reference_videos: ["https://example.org/reference"], audio: true }) });
    const url = new URL(plan.url);
    expect(url.pathname).toBe("/video/a%2Fb%3F");
    expect(url.searchParams.get("image")).toBe("https://example.org/start|https://example.org/end");
    expect(url.searchParams.get("reference_videos")).toBe("https://example.org/reference");
    expect(plan.headers.Prefer).toBe("respond-async");
    expect(plan.headers.Authorization).toBe("Bearer sk_test");
  });
  it("normalizes pending submissions and public cached results through the core", async () => {
    fetch.mockResolvedValueOnce(json({ id, status: "pending" }, 202));
    const result = await handleVideoProxyCore({ provider: "pollinations", action: "generations", credentials, rawBody: '{"model":"publisher/video","prompt":"cat"}', contentType: "application/json" });
    expect(result.success).toBe(true);
    expect(await result.response.json()).toMatchObject({ id, request_id: id, status: "pending" });
    fetch.mockResolvedValueOnce(clip());
    const cached = await handleVideoProxyCore({ provider: "pollinations", action: "generations", credentials, rawBody: '{"model":"publisher/video","prompt":"cat"}', contentType: "application/json" });
    expect(await cached.response.json()).toMatchObject({ status: "completed", video: { url: mediaUrl } });
  });
  it("polls jobs and resolves authenticated results without exposing secret URLs", async () => {
    fetch.mockResolvedValueOnce(json({ id, status: "succeeded", result_url: "https://attacker.invalid/result" })).mockResolvedValueOnce(clip());
    const result = await handleVideoProxyCore({ provider: "pollinations", requestId: id, credentials });
    expect(result.success).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe(`https://gen.pollinations.ai/v1/jobs/${id}`);
    expect(fetch.mock.calls[1][0]).toBe(`https://gen.pollinations.ai/v1/jobs/${id}/result`);
    expect(await result.response.json()).toMatchObject({ id, status: "completed", video: { url: mediaUrl } });
  });
  it("preserves failed jobs and upstream billing errors, rejects undocumented actions", async () => {
    expect(await video.parseResponse(json({ id, status: "failed", error: { message: "failed" } }))).toMatchObject({ status: "failed", error: { message: "failed" } });
    for (const action of ["edits", "extensions"]) {
      const result = await handleVideoProxyCore({ provider: "pollinations", action, credentials, rawBody: "{}", contentType: "application/json" });
      expect(result.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(json({ error: { message: "Insufficient pollen" } }, 402));
    const result = await handleVideoProxyCore({ provider: "pollinations", requestId: id, credentials });
    expect(result.status).toBe(402);
    expect(video.buildRequest({ requestId: "../bad", credentials }).error).toMatch(/job id/);
  });
});
