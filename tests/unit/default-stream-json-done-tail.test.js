// DF-9ROUTER-32 — a chat completion with NO `stream` key returned unparseable JSON.
//
// Dogfood 2026-09-20 (docs/dogfood/2026-09-20-integration.md §P0 DF-9ROUTER-32):
// omitting `stream` — what the OpenAI SDK/CLI does by default — answered with a
// NON-stream JSON body and the SSE terminator glued onto the end:
//
//   …"system_fingerprint":"qwen3.8-27b"}data: [DONE]
//
// `json.loads` fails with `Extra data: line 33 column 2`. Explicit `stream:true`
// returned correct SSE and explicit `stream:false` returned clean JSON, so the
// defect lived exactly in the OMITTED-key branch of the client-stream decision.
//
// Root cause (verified against the tree, not assumed): chatCore.js read
//
//   let stream = providerRequiresStreaming ? true : (body.stream !== false);
//
// so an omitted key (undefined) made the router treat the request as streaming
// end to end — while the outbound request body it sent carried NO `stream` key at
// all (verified by driving the real executor seam, see the third test below). An
// OpenAI-compatible upstream therefore answered plain `application/json` (the
// documented OpenAI default for an absent `stream`), and that raw JSON body was
// pushed through the streaming passthrough transform. That transform only
// understands `data:`-framed lines, so the JSON body passed through nearly
// verbatim and flush() appended the synthetic OpenAI terminator — the passthrough
// "hang workaround" for clients that wait for `data: [DONE]` — gluing SSE bytes
// onto the end of the JSON body.
//
// The contract these tests pin: an OMITTED `stream` key means the client wants
// non-streaming JSON (the documented OpenAI API default), so `stream: true` is
// the ONLY client-driven streaming trigger. Both upstream shapes must come back as
// pure JSON: an upstream that answers `application/json` (the normal case, because
// the router asks for no particular stream mode) and an upstream that answers SSE
// anyway (the safety net — handleNonStreamingResponse aggregates an event stream
// when one arrives).
//
// The executor is the only stub; everything else is the real wire path
// (handleChatCore → executor.execute → nonStreamingHandler / streamingHandler).
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

const executorStub = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    provider: "probe-node",
    noAuth: true,
    execute: executorStub.execute,
    refreshCredentials: async () => null,
  }),
}));

const usageDb = await import("@/lib/usageDb.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const PROVIDER = "probe-node";
const MODEL = "qwen3.8-27b";
const SENTINEL = "data: [DONE]";

// Upstream's own counts. The client-facing body of the NON-streaming path carries
// `addBufferToUsage()` (+2000 prompt tokens, a deliberate context buffer), so the
// wire body is asserted for shape and the RECORDED row for the exact numbers.
const REAL_PROMPT_TOKENS = 2592;
const REAL_COMPLETION_TOKENS = 105;

// --- upstream wire shapes ----------------------------------------------------

const chunkBase = { id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: MODEL };
const chunk = (delta, finishReason = null) => ({ ...chunkBase, choices: [{ index: 0, delta, finish_reason: finishReason }] });
const line = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

// A normal OpenAI-compatible upstream answering an event stream.
const UPSTREAM_SSE = [
  line(chunk({ role: "assistant", content: "DOGFOOD_" })),
  line(chunk({ content: "OK" })),
  line({ ...chunk({}, "stop"), usage: { prompt_tokens: REAL_PROMPT_TOKENS, completion_tokens: REAL_COMPLETION_TOKENS, total_tokens: REAL_PROMPT_TOKENS + REAL_COMPLETION_TOKENS } }),
  "data: [DONE]\n\n",
].join("");

// What an OpenAI-compatible upstream returns when the request body carries no
// `stream` key at all (the documented OpenAI default): one JSON body.
const UPSTREAM_JSON = JSON.stringify({
  id: "chatcmpl-probe-json",
  object: "chat.completion",
  created: 1,
  model: MODEL,
  choices: [{ index: 0, message: { role: "assistant", content: "DOGFOOD_OK" }, finish_reason: "stop" }],
  usage: { prompt_tokens: REAL_PROMPT_TOKENS, completion_tokens: REAL_COMPLETION_TOKENS, total_tokens: REAL_PROMPT_TOKENS + REAL_COMPLETION_TOKENS },
  system_fingerprint: "qwen3.8-27b",
});

function upstreamResponse(text, contentType) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status: 200, headers: { "content-type": contentType } });
}

// --- driver -----------------------------------------------------------------

let lastOutbound = null;

// `streamKey === undefined` builds the body the OpenAI SDK sends when the caller
// never mentions `stream` — the exact shape DF-9ROUTER-32 was reported against.
async function chatCompletion({ upstreamText, upstreamContentType, streamKey }) {
  executorStub.execute.mockImplementation(async ({ body: sent, stream }) => {
    // The outbound decision the ROUTER made, captured for the assertions below:
    // the fix must change what the upstream is asked for, not just the reply path.
    lastOutbound = { body: sent, stream };
    return {
      response: upstreamResponse(upstreamText, upstreamContentType),
      url: "https://probe.invalid/v1/chat/completions",
      headers: { "content-type": upstreamContentType },
      transformedBody: sent,
      responseFormat: FORMATS.OPENAI,
    };
  });

  const body = { model: `${PROVIDER}/${MODEL}`, messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }] };
  if (streamKey !== undefined) body.stream = streamKey;

  return handleChatCore({
    body,
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: {},
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      body,
    },
  });
}

const readBody = async (result) => {
  expect(result.success, `request failed: ${result.error || "unknown"}`).toBe(true);
  return result.response.text();
};

// Content of a client-facing SSE stream, deltas concatenated (an OpenAI chunk
// splits text arbitrarily, so a substring assertion on the raw stream is wrong).
const sseContent = (text) => text
  .split("\n")
  .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
  .map((l) => { try { return JSON.parse(l.slice(6))?.choices?.[0]?.delta?.content || ""; } catch { return ""; } })
  .join("");

const recordedUsage = () => usageDb.saveRequestUsage.mock.calls[0]?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  lastOutbound = null;
});

describe("DF-9ROUTER-32 — an omitted `stream` key returns pure JSON", () => {
  it("upstream answers application/json → body parses as JSON with no SSE tail", async () => {
    const result = await chatCompletion({
      upstreamText: UPSTREAM_JSON,
      upstreamContentType: "application/json",
    });
    const text = await readBody(result);

    // The acceptance criterion from the dogfood report: json.loads/JSON.parse works.
    expect(() => JSON.parse(text)).not.toThrow();

    const parsed = JSON.parse(text);
    expect(parsed.object).toBe("chat.completion");
    expect(parsed.choices[0].message.content).toBe("DOGFOOD_OK");

    // No SSE framing leaked into a JSON response body.
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain("data:");
    expect(result.response.headers.get("content-type")).toContain("application/json");

    // The exact reported symptom was the terminator glued onto the closing brace.
    expect(text.trimEnd().endsWith("}")).toBe(true);

    // …and the request is accounted for with the upstream's real counts.
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(recordedUsage().tokens.prompt_tokens).toBe(REAL_PROMPT_TOKENS);
    expect(recordedUsage().tokens.completion_tokens).toBe(REAL_COMPLETION_TOKENS);
  });

  it("upstream answers SSE anyway → the event stream is aggregated into JSON", async () => {
    // Safety net. Even when the request was NOT a streaming one the upstream may
    // still answer SSE (a forceStream provider, a gateway that streams by default,
    // a translator that rewrote the outbound body). handleNonStreamingResponse
    // aggregates that stream, so the client still gets pure JSON.
    const result = await chatCompletion({
      upstreamText: UPSTREAM_SSE,
      upstreamContentType: "text/event-stream",
    });
    const text = await readBody(result);

    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text);
    expect(parsed.choices[0].message.content).toBe("DOGFOOD_OK");

    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain("data:");
    expect(result.response.headers.get("content-type")).toContain("application/json");

    // The aggregation keeps the upstream's real counts in the recorded row.
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(recordedUsage().tokens.prompt_tokens).toBe(REAL_PROMPT_TOKENS);
    expect(recordedUsage().tokens.completion_tokens).toBe(REAL_COMPLETION_TOKENS);
  });

  it("asks the upstream for what the client asked for: an omitted key is a non-stream request", async () => {
    await chatCompletion({ upstreamText: UPSTREAM_JSON, upstreamContentType: "application/json" });

    // The router's own decision must not be "streaming" — this is the flag that
    // selected the passthrough SSE transform and appended `data: [DONE]` to a
    // JSON body. (The outbound body keeps the client's own shape: no `stream` key
    // is injected, which is why the upstream answers a single JSON body.)
    expect(lastOutbound.stream).toBe(false);
    expect(lastOutbound.body.stream).not.toBe(true);
  });
});

describe("DF-9ROUTER-32 — explicit stream flags keep their meaning", () => {
  it("stream:false is still a non-streaming JSON request", async () => {
    const result = await chatCompletion({
      upstreamText: UPSTREAM_JSON,
      upstreamContentType: "application/json",
      streamKey: false,
    });
    const text = await readBody(result);

    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toContain("[DONE]");
    expect(lastOutbound.stream).toBe(false);
    expect(lastOutbound.body.stream).toBe(false);
  });

  it("stream:true is still SSE, with exactly one terminator, after the content", async () => {
    const result = await chatCompletion({
      upstreamText: UPSTREAM_SSE,
      upstreamContentType: "text/event-stream",
      streamKey: true,
    });
    const text = await readBody(result);

    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    expect(sseContent(text)).toBe("DOGFOOD_OK");

    const sentinelCount = text.split(SENTINEL).length - 1;
    expect(sentinelCount).toBe(1);
    expect(text.trimEnd().endsWith(SENTINEL)).toBe(true);
    expect(text.indexOf("DOGFOOD_")).toBeLessThan(text.indexOf(SENTINEL));

    expect(lastOutbound.stream).toBe(true);
    expect(lastOutbound.body.stream).toBe(true);
  });
});
