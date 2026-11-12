// DF-9ROUTER-11 — non-streaming /v1/chat/completions returned HTTP 200 with an
// empty assistant content for a route whose upstream speaks the OpenAI Responses
// API (the advertised OpenCode Free models).
//
// Wire facts this pins (captured from the live upstream, opencode.ai/zen/v1/responses):
//   * the client sends `stream: false`;
//   * the OpenAI → Responses request translation ALWAYS sends `stream: true`
//     upstream, and /responses answers with `text/event-stream`;
//   * that event stream is a Responses event stream, not a Chat Completions one.
// The non-streaming JSON parser only reads `choices[].delta.content`, so it
// found nothing and returned a well-formed completion with `content: ""`.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

// Stub the executor so the upstream call itself is deterministic: the handler
// under test (routing + response assembly) stays real.
const executorStub = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    provider: "opencode",
    noAuth: true,
    execute: executorStub.execute,
    refreshCredentials: async () => null,
  }),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { convertResponsesStreamToJson } = await import("../../open-sse/transformer/streamToJsonConverter.js");

const MODEL = "muse-spark-1.2-contributor-free";
const PROVIDER = "opencode";

// Trimmed but faithful capture of one real /zen/v1/responses exchange: a
// reasoning item, then the assistant message streamed as `response.output_text.delta`
// and closed by `response.output_item.done`, then `response.completed` with usage.
const OPENCODE_SSE = [
  "event: response.created",
  'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_probe","object":"response","created_at":1789325828,"status":"in_progress","model":"muse-spark-1.2-contributor-free","output":[]}}',
  "",
  "event: response.in_progress",
  'data: {"type":"response.in_progress","sequence_number":1,"response":{"id":"resp_probe","status":"in_progress"}}',
  "",
  "event: response.output_item.added",
  'data: {"type":"response.output_item.added","sequence_number":2,"output_index":0,"item":{"id":"rs_0","type":"reasoning","status":"in_progress","summary":[]}}',
  "",
  "event: response.output_item.done",
  'data: {"type":"response.output_item.done","sequence_number":3,"output_index":0,"item":{"id":"rs_0","type":"reasoning","status":"completed","encrypted_content":"ENCRYPTED-REASONING-BLOB","summary":[]}}',
  "",
  "event: response.output_item.added",
  'data: {"type":"response.output_item.added","sequence_number":4,"output_index":1,"item":{"id":"msg_0","type":"message","status":"in_progress","role":"assistant","content":[]}}',
  "",
  "event: response.content_part.added",
  'data: {"type":"response.content_part.added","sequence_number":5,"output_index":1,"content_index":0,"item_id":"msg_0","part":{"type":"output_text","text":"","annotations":[]}}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","sequence_number":6,"output_index":1,"content_index":0,"item_id":"msg_0","delta":"DOGFOOD_","logprobs":[]}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","sequence_number":7,"output_index":1,"content_index":0,"item_id":"msg_0","delta":"OK","logprobs":[]}',
  "",
  "event: response.content_part.done",
  'data: {"type":"response.content_part.done","sequence_number":8,"output_index":1,"content_index":0,"item_id":"msg_0","part":{"type":"output_text","text":"DOGFOOD_OK","annotations":[]}}',
  "",
  "event: response.output_item.done",
  'data: {"type":"response.output_item.done","sequence_number":9,"output_index":1,"item":{"id":"msg_0","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"DOGFOOD_OK","annotations":[]}]}}',
  "",
  "event: response.completed",
  'data: {"type":"response.completed","sequence_number":10,"response":{"id":"resp_probe","status":"completed","output":[{"id":"msg_0","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"DOGFOOD_OK","annotations":[]}]}],"usage":{"input_tokens":15,"output_tokens":162,"total_tokens":177}}}',
  "",
  "event: ping",
  'data: {"type":"ping","cost":"0"}',
  "",
].join("\n");

// Same stream from an upstream that never closes the message item and never
// carries the text in a terminal payload — deltas are the only text source.
const DELTA_ONLY_SSE = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_delta","status":"in_progress"}}',
  "",
  "event: response.output_item.added",
  'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_d","type":"message","status":"in_progress","role":"assistant","content":[]}}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_d","delta":"DELTA_"}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_d","delta":"ONLY"}',
  "",
  "event: response.completed",
  'data: {"type":"response.completed","response":{"id":"resp_delta","status":"completed","usage":{"input_tokens":3,"output_tokens":4,"total_tokens":7}}}',
  "",
].join("\n");

function sseResponse(text, contentType = "text/event-stream") {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status: 200, headers: { "content-type": contentType } });
}

function stubUpstream(response, transformedBody) {
  executorStub.execute.mockImplementation(async ({ body }) => ({
    response,
    url: "https://opencode.ai/zen/v1/responses",
    headers: { "content-type": response.headers.get("content-type") },
    transformedBody: transformedBody ?? body,
    responseFormat: FORMATS.OPENAI_RESPONSES,
  }));
}

describe("DF-9ROUTER-11 — non-streaming chat against a Responses-API upstream", () => {
  it("stream:false returns the assistant content aggregated from the upstream SSE stream", async () => {
    stubUpstream(sseResponse(OPENCODE_SSE));
    // The upstream body is what the translator produced, i.e. it streams even
    // though the client asked for JSON — this is the root cause under test.
    let sentBody = null;
    executorStub.execute.mockImplementation(async ({ body }) => {
      sentBody = body;
      return {
        response: sseResponse(OPENCODE_SSE),
        url: "https://opencode.ai/zen/v1/responses",
        headers: { "content-type": "text/event-stream" },
        transformedBody: body,
        responseFormat: FORMATS.OPENAI_RESPONSES,
      };
    });

    const result = await handleChatCore({
      body: { model: `${PROVIDER}/${MODEL}`, messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }], stream: false },
      modelInfo: { provider: PROVIDER, model: MODEL },
      credentials: {},
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body: { model: `${PROVIDER}/${MODEL}`, stream: false } },
    });

    expect(sentBody?.stream).toBe(true); // translator forced the upstream to stream
    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.choices?.[0]?.message?.content).toBe("DOGFOOD_OK");
    expect(payload.usage).toMatchObject({ prompt_tokens: 15, completion_tokens: 162 });
  });

  it("stream:true still streams (no JSON aggregation on the streaming path)", async () => {
    stubUpstream(sseResponse(OPENCODE_SSE));
    const result = await handleChatCore({
      body: { model: `${PROVIDER}/${MODEL}`, messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }], stream: true },
      modelInfo: { provider: PROVIDER, model: MODEL },
      credentials: {},
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body: { model: `${PROVIDER}/${MODEL}`, stream: true } },
      stream: true,
    });

    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    const text = await result.response.text();
    let streamedContent = "";
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { streamedContent += JSON.parse(data)?.choices?.[0]?.delta?.content || ""; } catch { /* ignore */ }
    }
    expect(streamedContent).toBe("DOGFOOD_OK");
  });

  it("stream:false against a JSON (chat-native) upstream is unchanged", async () => {
    const json = { id: "chatcmpl-1", object: "chat.completion", created: 1, model: MODEL, choices: [{ index: 0, message: { role: "assistant", content: "JSON_OK" }, finish_reason: "stop" }] };
    stubUpstream(new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await handleChatCore({
      body: { model: `${PROVIDER}/${MODEL}`, messages: [{ role: "user", content: "hi" }], stream: false },
      modelInfo: { provider: PROVIDER, model: MODEL },
      credentials: {},
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body: { model: `${PROVIDER}/${MODEL}`, stream: false } },
    });

    const payload = await result.response.json();
    expect(payload.choices?.[0]?.message?.content).toBe("JSON_OK");
  });
});

describe("DF-9ROUTER-11 — Responses SSE → JSON aggregation", () => {
  it("keeps the message text when the upstream closes the item", async () => {
    const json = await convertResponsesStreamToJson(sseResponse(OPENCODE_SSE).body);
    const texts = (json.output || []).flatMap((item) => (item.content || []).map((c) => c.text));
    expect(texts).toEqual(["DOGFOOD_OK"]); // not doubled by the delta accumulator
    expect(json.usage).toMatchObject({ input_tokens: 15, output_tokens: 162, total_tokens: 177 });
  });

  it("falls back to output_text deltas when no closed item carries the text", async () => {
    const json = await convertResponsesStreamToJson(sseResponse(DELTA_ONLY_SSE).body);
    const texts = (json.output || []).flatMap((item) => (item.content || []).map((c) => c.text));
    expect(texts).toEqual(["DELTA_ONLY"]);
  });

  it("handleForcedSSEToJson turns a Responses SSE body into a populated chat completion", async () => {
    const result = await handleForcedSSEToJson({
      providerResponse: sseResponse(OPENCODE_SSE),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      provider: PROVIDER,
      model: MODEL,
      body: { messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      translatedBody: null,
      finalBody: null,
      requestStartTime: Date.now(),
      connectionId: "probe",
      apiKey: null,
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      onRequestSuccess: undefined,
      customToolNames: null,
      trackDone: () => {},
      appendLog: () => {},
      reqTag: "t",
      log: null,
    });

    expect(result?.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.choices?.[0]?.message?.content).toBe("DOGFOOD_OK");
    expect(payload.choices?.[0]?.finish_reason).toBe("stop");
  });
});
