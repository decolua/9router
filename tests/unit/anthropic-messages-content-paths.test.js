// DF-9ROUTER-16 — Anthropic-format `/v1/messages` completion paths.
//
// The endpoint delegates to the same engine as /v1/chat/completions, so a
// Claude-format client has to be given an Anthropic body/event stream no matter
// what wire format the upstream speaks. Two upstream shapes reach this code:
//
//   (a) a Responses-API upstream (OpenCode Free "muse-spark"): the
//       OpenAI→Responses request translation always sends `stream: true`, so a
//       `stream: false` client is served by the forced-SSE→JSON aggregation;
//   (b) a chat-native upstream that force-streams (`forceStream: true`
//       providers such as `openai`), which uses the standard SSE→JSON path.
//
// Both aggregation paths are Chat-Completions shaped: without an explicit
// conversion they return `{object: "chat.completion", choices: [...]}` to a
// client that reads `content[]` — HTTP 200 with no assistant content, which is
// indistinguishable from an empty answer.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

// Stub the executor: the upstream call is deterministic, the handler under test
// (format translation + response assembly) stays real.
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

const MODEL = "muse-spark-1.2-contributor-free";
const PROVIDER = "opencode";

// Faithful trim of one real /zen/v1/responses exchange: the assistant text
// arrives as `response.output_text.delta`, then `response.completed` with usage.
const RESPONSES_SSE = [
  "event: response.created",
  'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_probe","object":"response","created_at":1789325828,"status":"in_progress","output":[]}}',
  "",
  "event: response.output_item.added",
  'data: {"type":"response.output_item.added","sequence_number":2,"output_index":0,"item":{"id":"msg_0","type":"message","status":"in_progress","role":"assistant","content":[]}}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","sequence_number":6,"output_index":0,"content_index":0,"item_id":"msg_0","delta":"DOGFOOD_","logprobs":[]}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","sequence_number":7,"output_index":0,"content_index":0,"item_id":"msg_0","delta":"OK","logprobs":[]}',
  "",
  "event: response.output_item.done",
  'data: {"type":"response.output_item.done","sequence_number":9,"output_index":0,"item":{"id":"msg_0","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"DOGFOOD_OK","annotations":[]}]}}',
  "",
  "event: response.completed",
  'data: {"type":"response.completed","sequence_number":10,"response":{"id":"resp_probe","status":"completed","output":[],"usage":{"input_tokens":15,"output_tokens":162,"total_tokens":177}}}',
  "",
].join("\n");

// A chat-native upstream that answers a streaming request with chat SSE.
const CHAT_SSE = [
  'data: {"id":"chatcmpl-y","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"DOGFOOD_"},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-y","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-y","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":15,"completion_tokens":2,"total_tokens":17}}',
  "",
  "data: [DONE]",
  "",
].join("\n");

const CHAT_JSON = {
  id: "chatcmpl-z",
  object: "chat.completion",
  created: 1,
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content: "DOGFOOD_OK" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 15, completion_tokens: 2, total_tokens: 17 },
};

function sseResponse(text) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
}

const anthropicBody = (stream) => ({
  model: `${PROVIDER}/${MODEL}`,
  max_tokens: 64,
  messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }],
  stream,
});

async function requestMessages({ stream, upstream, responseFormat }) {
  executorStub.execute.mockImplementation(async ({ body }) => ({
    response: upstream,
    url: "https://opencode.ai/zen/v1/x",
    headers: { "content-type": upstream.headers.get("content-type") },
    transformedBody: body,
    responseFormat,
  }));

  return handleChatCore({
    body: anthropicBody(stream),
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: {},
    clientRawRequest: {
      endpoint: "/v1/messages",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: anthropicBody(stream),
    },
    stream: stream === true ? true : undefined,
    // What the /v1/messages route passes: detectFormatByEndpoint("/v1/messages").
    sourceFormatOverride: FORMATS.CLAUDE,
  });
}

function textFromClaudeSse(sse) {
  let text = "";
  for (const line of sse.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload);
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        text += event.delta.text || "";
      }
    } catch { /* framing lines */ }
  }
  return text;
}

describe("DF-9ROUTER-16 — /v1/messages non-streaming", () => {
  it("returns an Anthropic message with non-empty content when the upstream forced streaming (Responses API upstream)", async () => {
    const result = await requestMessages({ stream: false, upstream: sseResponse(RESPONSES_SSE), responseFormat: FORMATS.OPENAI_RESPONSES });

    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.type).toBe("message");
    expect(payload.role).toBe("assistant");
    expect(Array.isArray(payload.content)).toBe(true);
    const text = payload.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    expect(text).toBe("DOGFOOD_OK");
    expect(payload.stop_reason).toBe("end_turn");
    expect(payload.usage).toMatchObject({ input_tokens: 15, output_tokens: 162 });
    // An Anthropic client must never be handed a Chat Completions body.
    expect(payload.choices).toBeUndefined();
  });

  it("returns an Anthropic message when a force-streaming chat-native upstream answered with SSE", async () => {
    const result = await requestMessages({ stream: false, upstream: sseResponse(CHAT_SSE), responseFormat: FORMATS.OPENAI });

    const payload = await result.response.json();
    expect(payload.type).toBe("message");
    const text = payload.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    expect(text).toBe("DOGFOOD_OK");
    expect(payload.choices).toBeUndefined();
  });

  it("returns an Anthropic message when the upstream answered with plain JSON", async () => {
    const result = await requestMessages({ stream: false, upstream: jsonResponse(CHAT_JSON), responseFormat: FORMATS.OPENAI });

    const payload = await result.response.json();
    expect(payload.type).toBe("message");
    const text = payload.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    expect(text).toBe("DOGFOOD_OK");
  });
});

describe("DF-9ROUTER-16 — /v1/messages streaming", () => {
  it("delivers the assistant text as content_block_delta/text_delta events", async () => {
    const result = await requestMessages({ stream: true, upstream: sseResponse(RESPONSES_SSE), responseFormat: FORMATS.OPENAI_RESPONSES });

    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    const body = await result.response.text();
    expect(body).toContain("event: content_block_delta");
    expect(body).toContain('"type":"text_delta"');
    expect(textFromClaudeSse(body)).toBe("DOGFOOD_OK");
    // Anthropic streams terminate on message_stop, never on the OpenAI sentinel.
    expect(body).toContain("event: message_stop");
    expect(body).not.toContain("data: [DONE]");
  });

  it("delivers the assistant text when the stream ends without response.completed", async () => {
    const deltaOnly = [
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_d","status":"in_progress"}}',
      "",
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_d","delta":"DOGFOOD_"}',
      "",
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_d","delta":"OK"}',
      "",
    ].join("\n");

    const result = await requestMessages({ stream: true, upstream: sseResponse(deltaOnly), responseFormat: FORMATS.OPENAI_RESPONSES });
    expect(textFromClaudeSse(await result.response.text())).toBe("DOGFOOD_OK");
  });
});
