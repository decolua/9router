import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
vi.mock("../../open-sse/executors/index.js", async () => {
  const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
  return { getExecutor: (provider) => {
    const executor = new DefaultExecutor(provider);
    executor.config = { ...executor.config, retry: { 429: { attempts: 0 }, 502: { attempts: 0 }, 503: { attempts: 0 } } };
    return executor;
  } };
});
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => Object.fromEntries([
    "logClientRawRequest", "logRawRequest", "logOpenAIRequest", "logTargetRequest",
    "logProviderResponse", "logConvertedResponse", "logError",
  ].map((name) => [name, vi.fn()])),
}));

import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { initTranslators } from "../../open-sse/translator/index.js";
await initTranslators();

const log = Object.fromEntries(["line", "errorLine", "debug", "info", "warn", "error"].map((name) => [name, vi.fn()]));
const caption = "Pelan-pelan juga tetap maju. Apa langkah kecilmu hari ini?";
const usage = { prompt_tokens: 123, completion_tokens: 17, total_tokens: 140 };
const clientUsage = { prompt_tokens: 2123, completion_tokens: 17, total_tokens: 2140 };
const toolCalls = [{ id: "call_caption", type: "function", function: { name: "save_draft", arguments: '{"caption":"Langkah kecil"}' } }];
const request = (stream) => ({
  model: "mistral/codestral-latest",
  messages: [
    { role: "system", content: "Tulis caption Threads dalam Bahasa Indonesia. Gunakan sumber, hindari mengulang riwayat, dan keluarkan hanya draft." },
    { role: "user", content: "Sumber: seseorang belajar berkebun selama sepuluh menit setiap pagi. Riwayat terbaru: kemarin membahas membaca sebelum tidur. Buat pertanyaan penutup." },
  ],
  max_tokens: 128, ...(stream === undefined ? {} : { stream }),
});
const completion = (message = { role: "assistant", content: caption }, finishReason = "stop") => ({
  id: "chatcmpl-caption", object: "chat.completion", created: 1700000000, model: "codestral-latest",
  choices: [{ index: 0, message, finish_reason: finishReason }], usage,
});
const sseResponse = (value = completion()) => {
  const choice = value.choices[0];
  const frames = [
    { ...value, object: "chat.completion.chunk", usage: undefined, choices: [{ index: 0, delta: choice.message, finish_reason: null }] },
    { ...value, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] },
  ];
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });
};
const expectedCompletion = () => ({ ...completion(), usage: clientUsage });
const outgoing = () => JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
const route = (body = request(), provider = "mistral", extra = {}) => handleChatCore({
  body, modelInfo: { provider, model: provider === "mistral" ? "codestral-latest" : "gpt-4o" },
  credentials: { apiKey: "test-only", providerSpecificData: {} }, log,
  clientRawRequest: { endpoint: "/v1/chat/completions", headers: {}, body }, ...extra,
});
async function readSSE(response) {
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const text = await response.text();
  const lines = text.split("\n").filter((line) => line && !line.startsWith(":"));
  expect(lines.every((line) => line.startsWith("data: "))).toBe(true);
  expect(lines.at(-1)).toBe("data: [DONE]");
  return lines.filter((line) => line !== "data: [DONE]").map((line) => JSON.parse(line.slice(6)));
}
function expectCaptionChunks(chunks) {
  expect(chunks.flatMap((chunk) => chunk.choices || []).map((choice) => choice.delta?.content || "").join("")).toBe(caption);
  expect(chunks.some((chunk) => chunk.choices?.some((choice) => choice.finish_reason === "stop"))).toBe(true);
  expect(chunks.find((chunk) => chunk.usage)?.usage).toMatchObject(clientUsage);
  expect(chunks.find((chunk) => chunk.usage)?.usage.prompt_tokens).toBeGreaterThanOrEqual(usage.prompt_tokens);
}
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (_url, init) => JSON.parse(init.body).stream === true ? sseResponse() : Response.json(completion()));
});

describe("#5318 client and upstream response modes", () => {
  it.each([undefined, false, true])("keeps the Mistral wire body and client format consistent for stream=%s", async (stream) => {
    const result = await route(request(stream));
    expect(outgoing().stream).toBe(stream === true);
    expect(result.success).toBe(true);
    if (stream === true) expectCaptionChunks(await readSSE(result.response));
    else {
      expect(result.response.headers.get("content-type")).toContain("application/json");
      expect(await result.response.json()).toMatchObject(expectedCompletion());
    }
  });
  it.each([undefined, false])("keeps forced upstream streaming and returns JSON for stream=%s", async (stream) => {
    const result = await route(request(stream), "openai");
    expect(outgoing().stream).toBe(true);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    expect(await result.response.json()).toMatchObject({ choices: completion().choices, usage });
  });
  it.each([undefined, false])("returns JSON when a forced-stream provider sends JSON for stream=%s", async (stream) => {
    fetchMock.mockResolvedValueOnce(Response.json(completion()));
    const result = await route(request(stream), "openai");
    expect(outgoing().stream).toBe(true);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    expect(await result.response.json()).toMatchObject(expectedCompletion());
  });
  it("replays unexpected JSON as SSE with caption, finish reason and usage", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(completion()));
    const result = await route(request(true));
    expect(outgoing().stream).toBe(true);
    expectCaptionChunks(await readSSE(result.response));
  });
  it("translates a buffered OpenAI answer into Claude streaming events", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(completion({ role: "assistant", content: caption, tool_calls: toolCalls }, "tool_calls")));
    const result = await route(request(true), "mistral", { sourceFormatOverride: "claude" });
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    const text = await result.response.text();
    const events = text.split("\n").filter((line) => line.startsWith("data: ") && line !== "data: [DONE]").map((line) => JSON.parse(line.slice(6)));
    expect(events.filter((event) => event.type === "content_block_delta" && event.delta?.type === "text_delta").map((event) => event.delta.text).join("")).toBe(caption);
    expect(events.some((event) => event.type === "content_block_start" && event.content_block?.type === "tool_use" && event.content_block.name === "save_draft")).toBe(true);
    expect(events.some((event) => event.type === "message_delta" && event.delta?.stop_reason === "tool_use")).toBe(true);
    expect(events.some((event) => event.type === "message_stop")).toBe(true);
  });
  it("preserves multiple choices and content alongside tool calls in JSON replay", async () => {
    const value = completion({ role: "assistant", content: caption, tool_calls: toolCalls }, "tool_calls");
    value.choices.push({ index: 1, message: { role: "assistant", content: "Pilihan kedua" }, finish_reason: "length" });
    fetchMock.mockResolvedValueOnce(Response.json(value));
    const result = await route(request(true));
    const choices = (await readSSE(result.response)).flatMap((chunk) => chunk.choices || []);
    expect(choices.filter((choice) => choice.index === 0).map((choice) => choice.delta?.content || "").join("")).toBe(caption);
    expect(choices.filter((choice) => choice.index === 0).flatMap((choice) => choice.delta?.tool_calls || [])).toEqual([
      expect.objectContaining({ ...toolCalls[0], index: 0 }),
    ]);
    expect(choices.some((choice) => choice.index === 0 && choice.finish_reason === "tool_calls")).toBe(true);
    expect(choices.filter((choice) => choice.index === 1).map((choice) => choice.delta?.content || "").join("")).toBe("Pilihan kedua");
    expect(choices.some((choice) => choice.index === 1 && choice.finish_reason === "length")).toBe(true);
  });
  it.each([undefined, false, true])("preserves tool-only completions for stream=%s", async (stream) => {
    fetchMock.mockResolvedValueOnce(Response.json(completion({ role: "assistant", content: null, tool_calls: toolCalls }, "tool_calls")));
    const result = await route(request(stream));
    if (stream === true) {
      const chunks = await readSSE(result.response);
      const choices = chunks.flatMap((chunk) => chunk.choices || []);
      expect(choices.flatMap((choice) => choice.delta?.tool_calls || [])).toEqual([expect.objectContaining({ ...toolCalls[0], index: 0 })]);
      expect(choices.some((choice) => choice.finish_reason === "tool_calls")).toBe(true);
      expect(chunks.find((chunk) => chunk.usage)?.usage).toMatchObject(clientUsage);
    } else expect(await result.response.json()).toMatchObject({ choices: [{ message: { tool_calls: toolCalls }, finish_reason: "tool_calls" }], usage: clientUsage });
  });
});

describe("#5318 combo response contract", () => {
  async function combo(stream) {
    const handleSingleModel = vi.fn(async (body) => (await route(body)).response);
    const response = await handleComboChat({
      body: request(stream), models: ["mistral/codestral-latest", "mistral/mistral-large-latest"],
      handleSingleModel, log, comboStrategy: "fallback",
    });
    return { response, handleSingleModel };
  }
  it.each([undefined, false, true])("accepts valid JSON without another candidate for stream=%s", async (stream) => {
    fetchMock.mockImplementation(async () => Response.json(completion()));
    const { response, handleSingleModel } = await combo(stream);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    if (stream === true) expectCaptionChunks(await readSSE(response));
    else expect(await response.json()).toMatchObject(expectedCompletion());
  });
  it.each([false, true])("still falls back from a genuinely empty answer for stream=%s", async (stream) => {
    const empty = completion({ role: "assistant", content: "" }, stream ? "stop" : "incomplete");
    fetchMock.mockResolvedValueOnce(stream ? sseResponse(empty) : Response.json(empty));
    const { response, handleSingleModel } = await combo(stream);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    if (stream) expectCaptionChunks(await readSSE(response));
    else expect(await response.json()).toMatchObject(expectedCompletion());
  });
  it("still falls back from a failed primary", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: "Provider unavailable" } }, { status: 503 }));
    const { response, handleSingleModel } = await combo(false);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject(expectedCompletion());
  });
});

describe("#5318 failures stay failures", () => {
  it.each([undefined, false, true])("preserves HTTP errors for stream=%s", async (stream) => {
    const onRequestSuccess = vi.fn();
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: "Invalid request" } }, { status: 400 }));
    const result = await route(request(stream), "mistral", { onRequestSuccess });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toHaveProperty("error");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
  it("does not turn cancellation into an empty completion", async () => {
    const onRequestSuccess = vi.fn();
    fetchMock.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
    const result = await route(request(), "mistral", { onRequestSuccess });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(499);
    expect(await result.response.json()).toHaveProperty("error");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
  it.each([undefined, false, true].flatMap(stream => [{}, { choices: [] }].map(value => [stream, value])))("rejects invalid forced-provider completions for stream=%s body=%j", async (stream, value) => {
    const onRequestSuccess = vi.fn();
    fetchMock.mockResolvedValueOnce(Response.json(value));
    const result = await route(request(stream), "openai", { onRequestSuccess });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(await result.response.json()).toHaveProperty("error");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
  it.each([undefined, false, true].flatMap(stream => ["mistral", "openai"].map(provider => [stream, provider])))("rejects a JSON error envelope for stream=%s provider=%s", async (stream, provider) => {
    const onRequestSuccess = vi.fn();
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: "Generation failed" } }));
    const result = await route(request(stream), provider, { onRequestSuccess });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(await result.response.json()).toHaveProperty("error");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
  it.each([undefined, false, true].flatMap(stream => ["mistral", "openai"].map(provider => [stream, provider])))("preserves JSON read cancellation for stream=%s provider=%s", async (stream, provider) => {
    const onRequestSuccess = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.error(new DOMException("Cancelled", "AbortError")); },
    }), { headers: { "Content-Type": "application/json" } }));
    const result = await route(request(stream), provider, { onRequestSuccess });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(499);
    expect(await result.response.json()).toHaveProperty("error");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON on a streaming path", async () => {
    const onRequestSuccess = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response("{broken", { headers: { "Content-Type": "application/json" } }));
    const result = await route(request(true), "mistral", { onRequestSuccess });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(await result.response.json()).toHaveProperty("error");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
});
