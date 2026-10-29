// DF-9ROUTER-23 — a Responses-API upstream that closes its event stream WITHOUT
// a terminal event and produced no output was relayed as a successful
// completion:
//   * `/v1/chat/completions` → HTTP 200 with `finish_reason:"in_progress"` —
//     not an OpenAI finish_reason value;
//   * `/v1/messages` → `content:[{type:"text",text:""}]` with
//     `stop_reason:"end_turn"` — indistinguishable from a legitimate empty
//     answer, so a health check cannot tell "the model produced nothing" from
//     "the model had nothing to say".
//
// Live repro at HEAD (before this fix), opencode.ai free route
// `oc/muse-spark-1.2-contributor-free`, evidence /tmp/9r351_boundary.json:
// rows read `status:200, content:"", usage 0/0, finishReason:"in_progress"`.
//
// The contract pinned here:
//   * a stream that never emitted a terminal event is marked non-terminal by the
//     converter (its `status` stays the upstream value — `in_progress` is legal
//     for a Responses body);
//   * non-terminal + zero assistant output → 502, for BOTH the chat-completions
//     and the Anthropic client shapes;
//   * every 200 clamps `finish_reason` to {stop, length, tool_calls,
//     content_filter} — the raw upstream status never reaches a client nor the
//     recorded request-detail row;
//   * a COMPLETED upstream with empty output is still a legitimate 200.
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
const usageDb = await import("@/lib/usageDb.js");

const MODEL = "muse-spark-1.2-contributor-free";
const PROVIDER = "opencode";
const RESPONSES_PROVIDER = "codex";
const OPENAI_FINISH_ENUM = ["stop", "length", "tool_calls", "content_filter"];

// A stream that opens, reports in_progress, and simply closes: none of
// `response.completed` / `response.done` / `response.failed` / `response.incomplete`
// ever arrives, and no output is produced. This is the shape the live free route
// answered with.
const NONTERMINAL_EMPTY_SSE = [
  "event: response.created",
  'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_dead","object":"response","created_at":1789325828,"status":"in_progress","model":"muse-spark-1.2-contributor-free","output":[]}}',
  "",
  "event: response.in_progress",
  'data: {"type":"response.in_progress","sequence_number":1,"response":{"id":"resp_dead","status":"in_progress"}}',
  "",
].join("\n");

// Same non-terminal close, but the assistant text did arrive before the stream
// went away — partial output must NOT be discarded as an upstream failure.
const NONTERMINAL_TEXT_SSE = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_partial","status":"in_progress"}}',
  "",
  "event: response.output_item.added",
  'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_p","type":"message","status":"in_progress","role":"assistant","content":[]}}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_p","delta":"DOGFOOD_"}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_p","delta":"OK"}',
  "",
  "event: response.output_item.done",
  'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_p","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"DOGFOOD_OK","annotations":[]}]}}',
  "",
].join("\n");

const COMPLETED_TEXT_SSE = [
  ...NONTERMINAL_TEXT_SSE.split("\n"),
  "event: response.completed",
  'data: {"type":"response.completed","sequence_number":10,"response":{"id":"resp_ok","status":"completed","usage":{"input_tokens":15,"output_tokens":162,"total_tokens":177}}}',
  "",
].join("\n");

// The upstream explicitly finished with nothing to say: a legitimate empty answer.
const COMPLETED_EMPTY_SSE = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_empty","status":"in_progress"}}',
  "",
  "event: response.completed",
  'data: {"type":"response.completed","response":{"id":"resp_empty","status":"completed","output":[],"usage":{"input_tokens":7,"output_tokens":0,"total_tokens":7}}}',
  "",
].join("\n");

// Truncated at max_output_tokens: terminal, but the answer is short.
const INCOMPLETE_TEXT_SSE = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_cut","status":"in_progress"}}',
  "",
  "event: response.output_item.done",
  'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_c","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"PARTIAL","annotations":[]}]}}',
  "",
  "event: response.incomplete",
  'data: {"type":"response.incomplete","response":{"id":"resp_cut","status":"incomplete","usage":{"input_tokens":5,"output_tokens":9,"total_tokens":14}}}',
  "",
].join("\n");

function terminalOnly(eventType, status) {
  return [
    "event: response.created",
    'data: {"type":"response.created","response":{"id":"resp_t","status":"in_progress"}}',
    "",
    `event: ${eventType}`,
    `data: ${JSON.stringify({ type: eventType, response: { id: "resp_t", status } })}`,
    "",
  ].join("\n");
}

function sseResponse(text, contentType = "text/event-stream") {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status: 200, headers: { "content-type": contentType } });
}

// The handler is exercised directly (not through the executor stub) for the
// response-assembly contract; `provider` is a real Responses-format provider so
// the Codex/Responses branch is the one under test.
function forcedJsonCtx(sseText, sourceFormat, { onRequestSuccess } = {}) {
  return {
    providerResponse: sseResponse(sseText),
    sourceFormat,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    provider: RESPONSES_PROVIDER,
    model: MODEL,
    body: { model: `${RESPONSES_PROVIDER}/${MODEL}`, messages: [{ role: "user", content: "hi" }], stream: false },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "probe",
    apiKey: null,
    clientRawRequest: { endpoint: sourceFormat === FORMATS.CLAUDE ? "/v1/messages" : "/v1/chat/completions" },
    onRequestSuccess,
    customToolNames: null,
    trackDone: () => {},
    appendLog: () => {},
    reqTag: "t",
    log: null,
  };
}

function stubUpstream(response) {
  executorStub.execute.mockImplementation(async ({ body }) => ({
    response,
    url: "https://opencode.ai/zen/v1/responses",
    headers: { "content-type": response.headers.get("content-type") },
    transformedBody: body,
    responseFormat: FORMATS.OPENAI_RESPONSES,
  }));
}

describe("DF-9ROUTER-23 — stream closure is tracked, not inferred from status", () => {
  it("marks a stream that never emitted a terminal event as non-terminal", async () => {
    const json = await convertResponsesStreamToJson(sseResponse(NONTERMINAL_EMPTY_SSE).body);
    expect(json.terminal).toBe(false);
    // `status` keeps the upstream value: `in_progress` is a legal Responses status,
    // so the converter must not rewrite it — it exposes the closure instead.
    expect(json.status).toBe("in_progress");
    expect(json.output).toEqual([]);
    expect(json.usage).toMatchObject({ input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  });

  it.each([
    ["response.completed", "completed"],
    ["response.done", "completed"],
    ["response.incomplete", "incomplete"],
    ["response.failed", "failed"],
  ])("marks %s as terminal (status %s)", async (eventType, status) => {
    const json = await convertResponsesStreamToJson(sseResponse(terminalOnly(eventType, status)).body);
    expect(json.terminal).toBe(true);
    expect(json.status).toBe(status);
  });
});

describe("DF-9ROUTER-23 — non-terminal + zero output fails loud", () => {
  it("chat-completions client gets an error, not 200 + finish_reason:\"in_progress\"", async () => {
    const onRequestSuccess = vi.fn(async () => {});
    const result = await handleForcedSSEToJson(forcedJsonCtx(NONTERMINAL_EMPTY_SSE, FORMATS.OPENAI, { onRequestSuccess }));

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error.message).toContain("upstream_empty_completion");
    // Nothing completion-shaped may be relayed for a stream that never finished.
    expect(body).not.toHaveProperty("choices");
    expect(JSON.stringify(body)).not.toContain("in_progress");
    // Bookkeeping for a failed response must not run.
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("Claude /v1/messages client gets an error, not stop_reason:\"end_turn\" over empty content", async () => {
    const onRequestSuccess = vi.fn(async () => {});
    const result = await handleForcedSSEToJson(forcedJsonCtx(NONTERMINAL_EMPTY_SSE, FORMATS.CLAUDE, { onRequestSuccess }));

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error.message).toContain("upstream_empty_completion");
    expect(body).not.toHaveProperty("stop_reason");
    expect(body).not.toHaveProperty("content");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("fails the whole wire path (/v1/chat/completions, stream:false)", async () => {
    stubUpstream(sseResponse(NONTERMINAL_EMPTY_SSE));
    const result = await handleChatCore({
      body: { model: `${PROVIDER}/${MODEL}`, messages: [{ role: "user", content: "hi" }], stream: false },
      modelInfo: { provider: PROVIDER, model: MODEL },
      credentials: {},
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body: { model: `${PROVIDER}/${MODEL}`, stream: false } },
    });

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error.message).toContain("upstream_empty_completion");
    expect(body).not.toHaveProperty("choices");
  });
});

describe("DF-9ROUTER-23 — regression guards on the 200 paths", () => {
  it("completed + text → 200, finish_reason \"stop\", real content", async () => {
    const result = await handleForcedSSEToJson(forcedJsonCtx(COMPLETED_TEXT_SSE, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    const body = await result.response.json();
    expect(body.choices?.[0]?.message?.content).toBe("DOGFOOD_OK");
    expect(body.choices?.[0]?.finish_reason).toBe("stop");
    expect(OPENAI_FINISH_ENUM).toContain(body.choices[0].finish_reason);
  });

  it("completed with zero output → still 200 (legitimate empty answer)", async () => {
    const result = await handleForcedSSEToJson(forcedJsonCtx(COMPLETED_EMPTY_SSE, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    const body = await result.response.json();
    expect(body.choices?.[0]?.message?.content).toBe("");
    expect(body.choices?.[0]?.finish_reason).toBe("stop");
  });

  it("non-terminal + real assistant text → 200 with an enum finish_reason (no in_progress leak)", async () => {
    const result = await handleForcedSSEToJson(forcedJsonCtx(NONTERMINAL_TEXT_SSE, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices?.[0]?.message?.content).toBe("DOGFOOD_OK");
    expect(OPENAI_FINISH_ENUM).toContain(body.choices[0].finish_reason);
    expect(body.choices[0].finish_reason).toBe("stop");
  });

  it("claude client on a non-terminal stream that carried text → the text block", async () => {
    const result = await handleForcedSSEToJson(forcedJsonCtx(NONTERMINAL_TEXT_SSE, FORMATS.CLAUDE));
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.content).toEqual([{ type: "text", text: "DOGFOOD_OK" }]);
    expect(body.stop_reason).toBe("end_turn");
  });

  it("a truncated (incomplete) upstream answer → 200 with finish_reason \"length\"", async () => {
    const result = await handleForcedSSEToJson(forcedJsonCtx(INCOMPLETE_TEXT_SSE, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("PARTIAL");
    expect(body.choices[0].finish_reason).toBe("length");
  });

  it("records the MAPPED finish_reason in the request detail (never the raw upstream status)", async () => {
    usageDb.saveRequestDetail.mockClear();
    await handleForcedSSEToJson(forcedJsonCtx(NONTERMINAL_TEXT_SSE, FORMATS.OPENAI));

    const detail = usageDb.saveRequestDetail.mock.calls.at(-1)?.[0];
    expect(detail?.response?.finish_reason).toBe("stop");
    expect(OPENAI_FINISH_ENUM).toContain(detail.response.finish_reason);
  });
});
