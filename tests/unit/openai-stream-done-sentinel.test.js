// DF-9ROUTER-16 — the OpenAI Chat Completions stream terminator.
//
// Documented contract (docs/api-reference.md): "With `"stream": true` the server
// returns SSE chunks (`data: {"object":"chat.completion.chunk",...}` terminated by
// `data: [DONE]`)". A client therefore needs exactly ONE sentinel, and it must
// arrive after the content chunks. The upstream wire shape is not the client's
// business: a Responses-API / forced-stream upstream closes on
// `response.completed` and never sends the sentinel at all, while a chat-native
// upstream sends its own copy that must not be duplicated by the terminating
// append.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

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
const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");

const MODEL = "muse-spark-1.2-contributor-free";
const PROVIDER = "opencode";
const SENTINEL = "data: [DONE]";

// Responses-API upstream: closes on response.completed, never sends [DONE].
const RESPONSES_SSE = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_probe","status":"in_progress"}}',
  "",
  "event: response.output_item.added",
  'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_0","type":"message","status":"in_progress","role":"assistant","content":[]}}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_0","delta":"DOGFOOD_"}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_0","delta":"OK"}',
  "",
  "event: response.completed",
  'data: {"type":"response.completed","response":{"id":"resp_probe","status":"completed","usage":{"input_tokens":15,"output_tokens":162,"total_tokens":177}}}',
  "",
].join("\n");

// Chat-native upstream: sends its own sentinel, which the client must see once.
const CHAT_SSE = [
  'data: {"id":"chatcmpl-y","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"DOGFOOD_"},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-y","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-y","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":15,"completion_tokens":2,"total_tokens":17}}',
  "",
  SENTINEL,
  "",
].join("\n");

function sseResponse(text) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

const sentinelCount = (body) => body.split(SENTINEL).length - 1;

const chunkContent = (body) => body
  .split("\n")
  .filter((l) => l.startsWith("data: ") && l !== SENTINEL)
  .map((l) => { try { return JSON.parse(l.slice(6))?.choices?.[0]?.delta?.content || ""; } catch { return ""; } })
  .join("");

async function streamChat({ upstream, responseFormat }) {
  const body = { model: `${PROVIDER}/${MODEL}`, messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }], stream: true };
  executorStub.execute.mockImplementation(async ({ body: sent }) => ({
    response: upstream,
    url: "https://opencode.ai/zen/v1/x",
    headers: { "content-type": upstream.headers.get("content-type") },
    transformedBody: sent,
    responseFormat,
  }));

  const result = await handleChatCore({
    body,
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: {},
    clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body },
    stream: true,
  });
  return result.response.text();
}

async function runTransform(targetFormat, sourceFormat, input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(input)); controller.close(); },
  });
  const reader = stream.pipeThrough(createSSETransformStreamWithLogger(targetFormat, sourceFormat, "probe", null, null, MODEL)).getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

describe("DF-9ROUTER-16 — OpenAI streaming terminator", () => {
  it("emits exactly one data: [DONE] when the upstream is a forced-stream Responses API", async () => {
    const body = await streamChat({ upstream: sseResponse(RESPONSES_SSE), responseFormat: FORMATS.OPENAI_RESPONSES });

    expect(sentinelCount(body)).toBe(1);
    expect(body).toContain('"object":"chat.completion.chunk"');
    expect(chunkContent(body)).toBe("DOGFOOD_OK");
    // Content chunks must precede the terminator.
    expect(body.indexOf("DOGFOOD_")).toBeLessThan(body.indexOf(SENTINEL));
    expect(body.trimEnd().endsWith(SENTINEL)).toBe(true);
  });

  it("does not duplicate the upstream's own sentinel (passthrough chat upstream)", async () => {
    const body = await streamChat({ upstream: sseResponse(CHAT_SSE), responseFormat: FORMATS.OPENAI });

    expect(sentinelCount(body)).toBe(1);
    expect(chunkContent(body)).toBe("DOGFOOD_OK");
  });

  it("emits exactly one sentinel in translate mode when the upstream sends its own", async () => {
    const body = await runTransform(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, `${RESPONSES_SSE}\n${SENTINEL}\n`);

    expect(sentinelCount(body)).toBe(1);
    expect(chunkContent(body)).toBe("DOGFOOD_OK");
  });

  it("does not append the OpenAI sentinel to an Anthropic-format stream", async () => {
    const body = await runTransform(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, RESPONSES_SSE);

    expect(body).not.toContain(SENTINEL);
    expect(body).toContain("event: message_stop");
  });
});
