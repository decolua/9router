// The empty-stream guard: a stream that delivers no payload at all gets an
// in-band error frame in the client's format and is recorded as an error.
//
// The pipeline under test is the real one from the provider body to the client:
// upstream bytes → upstreamTap → client-format transform (open-sse/utils/stream.js)
// → empty-stream guard → client.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ saveRequestDetail: vi.fn(async () => {}) }));
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: mocks.saveRequestDetail,
  saveRequestUsage: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const { createEmptyStreamGuard, buildDefaultEmptyStreamTerminal } = await import("../../open-sse/utils/streamHandler.js");
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");
const { handleStreamingResponse, buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { initTranslators } = await import("../../open-sse/translator/index.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
await initTranslators();

const enc = new TextEncoder();
const streamOf = (frames) => new ReadableStream({
  start(c) { for (const f of frames) c.enqueue(typeof f === "string" ? enc.encode(f) : f); c.close(); },
});
const guardOutput = async (frames, opts) => new Response(streamOf(frames).pipeThrough(createEmptyStreamGuard(opts))).text();

// OpenAI-format frames
const ROLE = `data: {"id":"x","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n`;
const EMPTY_STOP = `data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`;
const CONTENT = (t) => `data: {"id":"x","choices":[{"index":0,"delta":{"content":"${t}"},"finish_reason":null}]}\n\n`;
const REASONING = `data: {"id":"x","choices":[{"index":0,"delta":{"reasoning_content":"hmm"},"finish_reason":null}]}\n\n`;
const DONE = `data: [DONE]\n\n`;
const DEFAULT_FRAME = new TextDecoder().decode(buildDefaultEmptyStreamTerminal());
const countDone = (s) => s.split("data: [DONE]").length - 1;

describe("createEmptyStreamGuard (unit)", () => {
  it("zero bytes → the error frame then [DONE]", async () => {
    const out = await guardOutput([]);
    expect(out).toBe(DEFAULT_FRAME);
    expect(JSON.parse(out.split("\n")[0].slice(6)).error).toMatchObject({ type: "upstream_empty_response", code: "empty_stream" });
  });
  it("a bare [DONE] (what the passthrough transform emits for a dead upstream) → frame BEFORE a single [DONE]", async () => {
    const out = await guardOutput([DONE]);
    expect(out).toBe(DEFAULT_FRAME);
    expect(countDone(out)).toBe(1);
  });
  it("keep-alive comments still flow through, then the frame", async () => {
    const out = await guardOutput([": ping\n\n", ": ping\n\n", DONE]);
    expect(out).toBe(`: ping\n\n: ping\n\n${DEFAULT_FRAME}`);
  });
  it("whitespace-only / blank lines → frame", async () => {
    expect(await guardOutput(["\n\n", "   \n", "\r\n"])).toBe(`\n\n   \n\r\n${DEFAULT_FRAME}`);
  });
  it("an empty data: line is not a payload", async () => {
    expect(await guardOutput(["data:\n\n", DONE])).toBe(`data:\n\n${DEFAULT_FRAME}`);
  });
  it("role-only delta + finish (empty-content shape) is NOT empty: byte-identical passthrough", async () => {
    const frames = [ROLE, EMPTY_STOP, DONE];
    expect(await guardOutput(frames)).toBe(frames.join(""));
  });
  it("reasoning-only stream is NOT empty: byte-identical passthrough", async () => {
    const frames = [ROLE, REASONING, EMPTY_STOP, DONE];
    expect(await guardOutput(frames)).toBe(frames.join(""));
  });
  it("normal content is a byte-identical passthrough", async () => {
    const frames = [ROLE, CONTENT("hi"), EMPTY_STOP, DONE];
    expect(await guardOutput(frames)).toBe(frames.join(""));
  });
  it("a payload split across chunks is still recognised (and nothing is held back)", async () => {
    const whole = CONTENT("split");
    const frames = [whole.slice(0, 10), whole.slice(10), DONE];
    expect(await guardOutput(frames)).toBe(frames.join(""));
  });
  it("a payload on a final line without a trailing newline is recognised at flush", async () => {
    expect(await guardOutput([`data: {"x":1}`])).toBe(`data: {"x":1}`);
  });
  it("a [DONE] arriving before the first payload keeps its order", async () => {
    expect(await guardOutput([DONE, CONTENT("late")])).toBe(DONE + CONTENT("late"));
  });
  it("Anthropic-format payloads count (event: + data:)", async () => {
    const f = `event: message_start\ndata: {"type":"message_start"}\n\n`;
    expect(await guardOutput([f])).toBe(f);
  });
  it("uses the caller's terminal when given one", async () => {
    const out = await guardOutput([], { emptyStreamTerminal: (m) => enc.encode(`event: error\ndata: ${m}\n\n`) });
    expect(out).toMatch(/^event: error\ndata: Upstream returned an empty stream/);
  });
});

// ── the real streaming pipeline (handleStreamingResponse) ────────────────────
const LOG = { line: vi.fn(), errorLine: vi.fn() };
function upstream(frames) {
  return new Response(streamOf(frames), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
async function stream({ frames, sourceFormat = FORMATS.OPENAI, provider = "openai", targetFormat = FORMATS.OPENAI, model = "m" }) {
  const body = { model, stream: true, messages: [{ role: "user", content: "hi" }] };
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({
    provider, model, connectionId: "conn", apiKey: "sk-x", requestStartTime: Date.now(), body, stream: true,
    clientRawRequest: { endpoint: "/v1/chat/completions" }, reqTag: "t", log: LOG,
  });
  const streamController = createStreamController({ log: LOG, provider, model });
  const res = await handleStreamingResponse({
    providerResponse: upstream(frames), provider, model, sourceFormat, targetFormat, body, stream: true,
    requestStartTime: Date.now(), connectionId: "conn", apiKey: "sk-x", streamController, onStreamComplete, streamDetailId,
    reqTag: "t", log: LOG,
  });
  return res.response;
}
const finalStatus = () => {
  const calls = mocks.saveRequestDetail.mock.calls.map(([d]) => d);
  return calls[calls.length - 1]?.status;
};

beforeEach(() => vi.clearAllMocks());

describe("single model, real pipeline", () => {
  it("OpenAI client, OpenAI-compatible provider (passthrough), zero bytes → error frame + [DONE], status error", async () => {
    const out = await (await stream({ frames: [] })).text();
    expect(out).toBe(DEFAULT_FRAME);
    expect(finalStatus()).toBe("error");
    expect(LOG.errorLine).toHaveBeenCalledWith("t", "✗", expect.stringContaining("EMPTY STREAM"));
  });
  it("passthrough keep-alive comments only → comments, error frame, single [DONE], status error", async () => {
    const out = await (await stream({ frames: [": keepalive\n\n", ": keepalive\n\n"] })).text();
    expect(out).toContain("empty_stream");
    expect(countDone(out)).toBe(1);
    expect(out.indexOf("empty_stream")).toBeLessThan(out.indexOf("[DONE]"));
    expect(finalStatus()).toBe("error");
  });
  it("passthrough whitespace only → error frame, status error", async () => {
    const out = await (await stream({ frames: ["\n\n\n"] })).text();
    expect(out).toContain("empty_stream");
    expect(finalStatus()).toBe("error");
  });
  it("Anthropic client (/v1/messages), OpenAI provider, zero bytes → Anthropic `event: error`, status error", async () => {
    const out = await (await stream({ frames: [], sourceFormat: FORMATS.CLAUDE })).text();
    expect(out).toMatch(/^event: error\ndata: /);
    const data = JSON.parse(out.split("\n")[1].slice(6));
    expect(data).toMatchObject({ type: "error", error: { type: "api_error" } });
    expect(data.error.message).toContain("empty stream");
    expect(out).not.toContain("[DONE]");
    expect(finalStatus()).toBe("error");
  });
  it("Responses client (/v1/responses), OpenAI-compatible provider (translated), zero bytes → response.failed terminal, status error", async () => {
    const out = await (await stream({ frames: [], sourceFormat: FORMATS.OPENAI_RESPONSES })).text();
    expect(out).toMatch(/^event: response\.failed\ndata: \{"type":"response\.failed"/);
    expect(out).toContain('"code":"stream_disconnected"');
    expect(out).not.toContain("event: response.completed");
    expect(out).not.toContain("empty_stream");
    expect(finalStatus()).toBe("error");
  });
  it("Responses client (translated), keep-alive comments only → the response.failed terminal", async () => {
    const out = await (await stream({ frames: [": keepalive\n\n"], sourceFormat: FORMATS.OPENAI_RESPONSES })).text();
    expect(out).toMatch(/^event: response\.failed\n/);
    expect(out).not.toContain("event: response.completed");
  });
  it("Responses client (translated), started-but-empty (role + stop) → unchanged: created / in_progress / completed, no failure frame", async () => {
    const out = await (await stream({ frames: [ROLE, EMPTY_STOP, DONE], sourceFormat: FORMATS.OPENAI_RESPONSES })).text();
    expect(out).toContain("event: response.created");
    expect(out).toContain("event: response.completed");
    expect(out).not.toContain("response.failed");
  });
  it("Responses client (translated), normal reply → unchanged, recorded success", async () => {
    const out = await (await stream({ frames: [ROLE, CONTENT("hello"), EMPTY_STOP, DONE], sourceFormat: FORMATS.OPENAI_RESPONSES })).text();
    expect(out).toContain("event: response.output_text.delta");
    expect(out).toContain("hello");
    expect(out).toContain("event: response.completed");
    expect(out).not.toContain("response.failed");
    expect(finalStatus()).toBe("success");
  });
  it("Responses passthrough, zero bytes → response.failed terminal (unchanged)", async () => {
    const out = await (await stream({ frames: [], sourceFormat: FORMATS.OPENAI_RESPONSES, targetFormat: FORMATS.OPENAI_RESPONSES })).text();
    expect(out).toMatch(/^event: response\.failed\n/);
    expect(out.split("event: response.failed").length - 1).toBe(1);
  });
  it("Gemini provider → OpenAI client (translated), zero bytes → error frame, status error", async () => {
    const out = await (await stream({ frames: [], provider: "gemini", targetFormat: FORMATS.GEMINI })).text();
    expect(out).toBe(DEFAULT_FRAME);
    expect(finalStatus()).toBe("error");
  });
  it("role-only (empty-content shape) → no error frame; status error (no content, no completion tokens)", async () => {
    const out = await (await stream({ frames: [ROLE, EMPTY_STOP, DONE] })).text();
    expect(out).not.toContain("empty_stream");
    expect(finalStatus()).toBe("error");
  });
  it("reasoning-only → no error frame, status success (thinking was produced)", async () => {
    const out = await (await stream({ frames: [ROLE, REASONING, EMPTY_STOP, DONE] })).text();
    expect(out).not.toContain("empty_stream");
    expect(finalStatus()).toBe("success");
  });
  it("a normal stream is unchanged and recorded success", async () => {
    const frames = [ROLE, CONTENT("hello"), EMPTY_STOP, DONE];
    const out = await (await stream({ frames })).text();
    expect(out).toContain("hello");
    expect(out).not.toContain("empty_stream");
    expect(finalStatus()).toBe("success");
    expect(LOG.errorLine).not.toHaveBeenCalled();
  });
});

// The openai→responses translator no longer synthesizes a lone response.completed
// for a stream that never started (that hid the empty stream from the guard above).
describe("openai→responses translator flush (never started vs started)", async () => {
  const { openaiToOpenAIResponsesResponse } = await import("../../open-sse/translator/response/openai-responses.js");
  const { initState } = await import("../../open-sse/translator/index.js");
  it("never started (no chunk with choices) → flush emits nothing", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    expect(openaiToOpenAIResponsesResponse(null, state)).toEqual([]);
  });
  it("a usage-only chunk (no choices) does not start the stream → flush emits nothing", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    openaiToOpenAIResponsesResponse({ id: "x", choices: [], usage: { prompt_tokens: 1, completion_tokens: 0 } }, state);
    expect(openaiToOpenAIResponsesResponse(null, state)).toEqual([]);
  });
  it("started (role chunk) but no content → flush still completes the response, as before", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const first = openaiToOpenAIResponsesResponse({ id: "x", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }, state);
    expect(first.map((e) => e.event)).toEqual(["response.created", "response.in_progress"]);
    expect(openaiToOpenAIResponsesResponse(null, state).map((e) => e.event)).toEqual(["response.completed"]);
  });
});
