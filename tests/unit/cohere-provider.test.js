import { afterEach, describe, expect, it, vi } from "vitest";
import { Buffer, File } from "node:buffer";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import cohere from "../../open-sse/providers/registry/cohere.js";
import { CohereExecutor } from "../../open-sse/executors/cohere.js";
import embedding from "../../open-sse/handlers/embeddingProviders/cohere.js";
import { clearCohereCatalog, normalizeCohereModel, resolveCohereModels } from "../../open-sse/services/cohereModels.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

const image = "data:image/png;base64,AQID";
const credentials = { apiKey: "trial-test-key" };
const response = (data) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.resetAllMocks();
  clearCohereCatalog();
});

describe("Cohere free evaluation provider", () => {
  it("uses documented compatibility chat, API key validation and native embed endpoints", () => {
    expect(cohere).toMatchObject({ category: "freeTier", authType: "apikey", hasFree: true });
    expect(cohere.transport.baseUrl).toBe("https://api.cohere.ai/compatibility/v1/chat/completions");
    expect(cohere.transport.validateUrl).toBe("https://api.cohere.com/v1/models?page_size=1");
    expect(cohere.embeddingConfig.baseUrl).toBe("https://api.cohere.com/v2/embed");
    expect(cohere.serviceKinds).toEqual(["llm", "embedding", "stt"]);
    expect(cohere.models.every((model) => model.trialEligible === true)).toBe(true);
    expect(new Set(cohere.models.map((model) => model.id)).size).toBe(cohere.models.length);
    expect(cohere.models.find((model) => model.id === "command-a-plus-05-2026").capabilities).toMatchObject({ vision: true, reasoning: true, tools: true });
    expect(cohere.models.filter((model) => model.kind === "embedding")).toHaveLength(7);
    expect(cohere.models.some((model) => model.id === "command-r")).toBe(false);
  });

  it("preserves tool history, vision, strict tools and supported reasoning", () => {
    const executor = new CohereExecutor();
    const messages = [
      { role: "user", content: [{ type: "image_url", image_url: { url: image } }] },
      { role: "assistant", tool_calls: [{ id: "call1", type: "function", function: { name: "lookup", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call1", content: "found" },
    ];
    const tools = [{ type: "function", function: { name: "lookup", strict: true, parameters: { type: "object", properties: {} } } }];
    const body = executor.transformRequest("command-a-plus-05-2026", { messages, tools, reasoning_effort: "high", max_completion_tokens: 100, parallel_tool_calls: true, stream_options: { include_usage: true } }, true, credentials);
    expect(body).toMatchObject({ model: "command-a-plus-05-2026", stream: true, messages, tools, reasoning_effort: "high", max_tokens: 100 });
    expect(body).not.toHaveProperty("max_completion_tokens");
    expect(body).not.toHaveProperty("parallel_tool_calls");
    expect(body).not.toHaveProperty("stream_options");
    expect(() => executor.transformRequest("command-a-plus-05-2026", { reasoning_effort: "medium" }, false, credentials)).toThrow(/none.*high/);
  });

  it("translates OpenAI JSON Schema to the documented Cohere schema shape without losing constraints", () => {
    const schema = { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false };
    const input = { response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } } };
    const body = new CohereExecutor().transformRequest("command-a-plus-05-2026", input, false, credentials);
    expect(body.response_format).toEqual({ type: "json_object", schema });
    expect(input.response_format.type).toBe("json_schema");
  });

  it.each([false, true])("passes chat %s responses through without rewriting tool/reasoning payloads", async (stream) => {
    const payload = stream
      ? 'data: {"choices":[{"delta":{"reasoning_content":"think","tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n'
      : JSON.stringify({ choices: [{ message: { role: "assistant", content: "answer", reasoning_content: "think", tool_calls: [] } }] });
    proxyAwareFetch.mockResolvedValue(new Response(payload, { headers: { "Content-Type": stream ? "text/event-stream" : "application/json" } }));
    const result = await new CohereExecutor().execute({ model: "command-a-plus-05-2026", body: { messages: [{ role: "user", content: "Hi" }] }, stream, credentials });
    expect(await result.response.text()).toBe(payload);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(cohere.transport.baseUrl);
    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer trial-test-key");
  });
});

describe("Cohere catalog discovery", () => {
  it("paginates, classifies endpoints, carries capabilities and excludes deprecated/unsupported/nontrial entries", async () => {
    proxyAwareFetch.mockResolvedValueOnce(response({ models: [
      { name: "command-a-plus-05-2026", endpoints: ["chat"], context_length: 128000 },
      { name: "embed-v4.0", endpoints: ["embed"] },
      { name: "rerank-v5.0-pro", endpoints: ["rerank"] },
      { name: "old", endpoints: ["chat"], is_deprecated: true },
    ], next_page_token: "next+/=" })).mockResolvedValueOnce(response({ models: [
      { name: "new-chat", endpoints: ["chat"], features: ["vision", "reasoning", "tool_use"] },
      { name: "paid-chat", endpoints: ["chat"], trial_eligible: false },
      { name: "cohere-transcribe-03-2026", endpoints: [] },
    ] }));
    const proxyOptions = { proxyUrl: "http://proxy:8080" };
    const result = await resolveCohereModels(credentials, { proxyOptions });
    expect(result.models.map((model) => model.kind)).toEqual(["llm", "embedding", "llm", "stt"]);
    expect(result.models[0].capabilities).toMatchObject({ vision: true, reasoning: true, tools: true, contextWindow: 128000 });
    expect(result.models[2].capabilities).toMatchObject({ vision: true, reasoning: true, tools: true });
    expect(result.models[2]).not.toHaveProperty("trialEligible");
    expect(new URL(proxyAwareFetch.mock.calls[1][0]).searchParams.get("page_token")).toBe("next+/=");
    expect(proxyAwareFetch.mock.calls[0][2]).toBe(proxyOptions);
    expect(await resolveCohereModels(credentials, { proxyOptions })).toBe(result);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("isolates credential and proxy caches and preserves an authoritative empty list", async () => {
    proxyAwareFetch.mockImplementation(async () => response({ models: [] }));
    expect((await resolveCohereModels(credentials)).models).toEqual([]);
    await resolveCohereModels({ apiKey: "other-key" });
    await resolveCohereModels(credentials, { proxyOptions: { proxyUrl: "http://proxy" } });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("rejects malformed catalogs, repeated pagination and upstream authorization errors", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    await expect(resolveCohereModels(credentials)).rejects.toMatchObject({ status: 401 });
    proxyAwareFetch.mockResolvedValueOnce(response({ data: [] }));
    await expect(resolveCohereModels(credentials)).rejects.toThrow(/catalog response/);
    proxyAwareFetch.mockImplementation(async () => response({ models: [], next_page_token: "loop" }));
    await expect(resolveCohereModels(credentials)).rejects.toThrow(/pagination/);
    expect(normalizeCohereModel({ name: "embed-v4.0", endpoints: ["embed"], trial_eligible: false }).trialEligible).toBe(false);
    await expect(resolveCohereModels({})).rejects.toMatchObject({ status: 401 });
  });

  it("retains documented STT models when the legacy catalog omits that endpoint", async () => {
    proxyAwareFetch.mockResolvedValue(response({ models: [{ name: "embed-v4.0", endpoints: ["embed"] }] }));
    const result = await resolveCohereModels(credentials);
    expect(result.models.filter((model) => model.kind === "stt").map((model) => model.id)).toEqual(["cohere-transcribe-03-2026", "cohere-transcribe-arabic-07-2026"]);
  });

  it("never restores STT models explicitly excluded from the trial catalog", async () => {
    proxyAwareFetch.mockResolvedValue(response({ models: [
      { name: "embed-v4.0", endpoints: ["embed"] },
      { name: "cohere-transcribe-03-2026", endpoints: [], trial_eligible: false },
    ] }));
    expect((await resolveCohereModels(credentials)).models.every((model) => model.kind !== "stt")).toBe(true);
  });

  it("bounds credential-scoped cache entries and honors explicit refresh", async () => {
    proxyAwareFetch.mockImplementation(async () => response({ models: [] }));
    await resolveCohereModels(credentials);
    for (let i = 0; i < 128; i++) await resolveCohereModels({ apiKey: `key-${i}` });
    await resolveCohereModels(credentials);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(130);
    await resolveCohereModels(credentials, { forceRefresh: true });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(131);
  });
});

describe("Cohere embeddings", () => {
  it("uses native text input, dimensions and documented usage", () => {
    const ctx = {};
    expect(embedding.buildBody("embed-v4.0", { input: ["hello", "world"], dimensions: 512, input_type: "search_query" }, ctx)).toEqual({ model: "embed-v4.0", texts: ["hello", "world"], input_type: "search_query", embedding_types: ["float"], output_dimension: 512 });
    expect(embedding.normalize({ embeddings: { float: [[1, 2], [3, 4]] }, meta: { billed_units: { input_tokens: 8 } } }, "embed-v4.0", ctx)).toEqual({ object: "list", model: "embed-v4.0", data: [{ object: "embedding", index: 0, embedding: [1, 2] }, { object: "embedding", index: 1, embedding: [3, 4] }], usage: { prompt_tokens: 8, total_tokens: 8 } });
  });

  it("encodes float32 little-endian per request without cross-request state", () => {
    const base64 = {}, floats = {};
    embedding.buildBody("embed-v4.0", { input: "hello", encoding_format: "base64" }, base64);
    embedding.buildBody("embed-v4.0", { input: "world" }, floats);
    const upstream = { embeddings: { float: [[1, -2]] }, meta: { billed_units: { text_tokens: 2, image_tokens: 3 } } };
    const encoded = embedding.normalize(upstream, "embed-v4.0", base64);
    const bytes = Buffer.from(encoded.data[0].embedding, "base64");
    expect([bytes.readFloatLE(0), bytes.readFloatLE(4)]).toEqual([1, -2]);
    expect(encoded.usage.total_tokens).toBe(5);
    expect(embedding.normalize(upstream, "embed-v4.0", floats).data[0].embedding).toEqual([1, -2]);
  });

  it("supports mixed inputs in v4/v5 and single image input in v3", () => {
    const mixed = [{ content: [{ type: "text", text: "caption" }, { type: "image_url", image_url: { url: image } }] }];
    expect(embedding.buildBody("embed-v4.0", { input: mixed }).inputs).toBe(mixed);
    expect(embedding.buildBody("embed-v5.0-pro", { input: mixed, dimensions: 768 }).output_dimension).toBe(768);
    const imageOnly = [{ content: [{ type: "image_url", image_url: { url: image } }] }];
    expect(embedding.buildBody("embed-english-v3.0", { input: imageOnly })).toMatchObject({ images: [image], input_type: "image" });
    expect(() => embedding.buildBody("embed-english-v3.0", { input: mixed })).toThrow(/cannot mix/);
  });

  it.each([
    { input: [] }, { input: ["ok", 1] }, { input: [1, 2] }, { input: "" },
    { input: Array(97).fill("text") }, { input: "ok", dimensions: 123 },
    { input: "ok", dimensions: "512" }, { input: "ok", encoding_format: "binary" },
    { input: "ok", input_type: "bogus" }, { input: "ok", truncate: "invalid" },
    { input: "ok", max_tokens: 0 },
    { input: [{ content: [{ type: "image_url", image_url: { url: "https://example.com/image.png" } }] }] },
  ])("validates unsupported embedding input %j", (body) => {
    expect(() => embedding.buildBody("embed-v4.0", body)).toThrow();
  });

  it("rejects invalid upstream vectors or mismatched item counts", () => {
    expect(() => embedding.normalize({ embeddings: { float: [[1]] } }, "embed-v4.0", { embeddingCount: 2 })).toThrow(/count/);
    expect(() => embedding.normalize({ embeddings: { float: [[NaN]] } }, "embed-v4.0")).toThrow(/vector/);
  });
});

describe("Cohere audio transcriptions", () => {
  const form = (options = {}) => {
    const values = new Map(Object.entries({ language: "en", ...options }));
    values.set("file", new File(["audio"], options.filename || "audio.wav", { type: "audio/wav" }));
    return { get: (key) => values.get(key) ?? null };
  };
  const transcribe = (formData, extra = {}) => handleSttCore({ provider: "cohere", model: "cohere-transcribe-03-2026", formData, credentials, sttConfig: cohere.sttConfig, ...extra });

  it("sends required language and file last while preserving proxy and signal", async () => {
    proxyAwareFetch.mockResolvedValue(response({ text: "hello" }));
    const signal = new AbortController().signal;
    const proxyOptions = { proxyUrl: "http://proxy" };
    const result = await transcribe(form(), { signal, proxyOptions });
    expect(result.success).toBe(true);
    const [url, options, proxy] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(cohere.sttConfig.baseUrl);
    expect(options.signal).toBe(signal);
    expect(proxy).toBe(proxyOptions);
    expect([...options.body.keys()]).toEqual(["model", "language", "file"]);
    expect(options.headers.Authorization).toBe("Bearer trial-test-key");
    expect(await result.response.json()).toEqual({ text: "hello" });
  });

  it("rejects audio above the documented 25MB limit without uploading", async () => {
    const values = new Map([["language", "en"], ["file", { name: "audio.wav", size: 25 * 1024 * 1024 + 1, arrayBuffer: async () => new ArrayBuffer(0) }]]);
    const result = await transcribe({ get: (key) => values.get(key) ?? null });
    expect(result.status).toBe(400);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it.each([{ language: "" }, { filename: "audio.webm" }, { response_format: "text" }, { prompt: "hint" }])("rejects incompatible transcription parameters %j", async (options) => {
    const result = await transcribe(form(options));
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
