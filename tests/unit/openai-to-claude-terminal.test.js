// DF-9ROUTER-21 — the Claude (Anthropic) stream terminator.
//
// Contract: an Anthropic-format stream ends with `message_delta` (carrying
// stop_reason) followed by exactly one `message_stop`. The upstream wire shape is
// not the client's business — a chat-native upstream may close the connection
// without ever sending a `finish_reason` chunk (bare EOF, no `[DONE]`), and a
// Responses-API upstream closes on `response.completed` instead. The translator
// only emitted the terminal inside `if (choice.finish_reason)`, and the
// stream.js flush sentinel is gated on OpenAI-format clients, so a Claude client
// received ZERO message_stop and hung until timeout.
//
// The fix: stream.js's flush translates one final `null` chunk; the translator
// now synthesises the terminal there (shared helper + a `claudeTerminalSent`
// latch so a real finish_reason is never followed by a second message_stop).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

// Stub the executor: the upstream call is deterministic, the handler under test
// (format translation + stream termination) stays real.
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
const { initState } = await import("../../open-sse/translator/index.js");
const { openaiToClaudeResponse } = await import("../../open-sse/translator/response/openai-to-claude.js");

const MODEL = "muse-spark-1.2-contributor-free";
const PROVIDER = "opencode";
const SENTINEL = "data: [DONE]";

const chatChunk = (delta, { id = "chatcmpl-probe", finish = null, usage = null } = {}) => JSON.stringify({
  id,
  object: "chat.completion.chunk",
  created: 1,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(usage ? { usage } : {}),
});

// Chat-native upstream that streams content and CLOSES without a finish_reason
// chunk (the shape the ticket reproduces: content forwarded, no terminal).
const CHAT_NO_FINISH_SSE = [
  `data: ${chatChunk({ role: "assistant", content: "DOGFOOD_" })}`,
  "",
  `data: ${chatChunk({ content: "OK" })}`,
  "",
].join("\n");

// Same upstream, but well-behaved: finish_reason + usage, then EOF.
const CHAT_WITH_FINISH_SSE = [
  `data: ${chatChunk({ role: "assistant", content: "DOGFOOD_" })}`,
  "",
  `data: ${chatChunk({ content: "OK" })}`,
  "",
  `data: ${chatChunk({}, { finish: "stop", usage: { prompt_tokens: 15, completion_tokens: 2, total_tokens: 17 } })}`,
  "",
  SENTINEL,
  "",
].join("\n");

// Partial tool_use: content, then a tool call whose args are still streamed when
// the upstream closes — no finish chunk, so the args must be flushed and the
// blocks closed by the synthetic terminal.
const CHAT_TOOL_NO_FINISH_SSE = [
  `data: ${chatChunk({ role: "assistant", content: "Checking" }, { id: "chatcmpl-tool" })}`,
  "",
  `data: ${chatChunk({ tool_calls: [{ index: 0, id: "toolu_probe", type: "function", function: { name: "Read", arguments: '{"file_path":"/tmp/probe.txt","limit":"9999"}' } }] }, { id: "chatcmpl-tool" })}`,
  "",
].join("\n");

// A Gemini-format upstream: its own response translator returns null for the
// flush chunk, so the terminal has to come from the client-format clause in
// stream.js rather than the OpenAI→Claude flush call.
const GEMINI_NO_FINISH_SSE = [
  'data: {"candidates":[{"index":0,"content":{"parts":[{"text":"DOGFOOD_"}],"role":"model"}}],"modelVersion":"gemini-probe"}',
  "",
  'data: {"candidates":[{"index":0,"content":{"parts":[{"text":"OK"}],"role":"model"}}],"modelVersion":"gemini-probe"}',
  "",
].join("\n");

function sseResponse(text) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

// --- SSE parsing helpers (the body is the client's whole view) ---------------

function claudeEvents(body) {
  const events = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try { events.push(JSON.parse(payload)); } catch { /* framing lines */ }
  }
  return events;
}

const countType = (events, type) => events.filter((e) => e.type === type).length;
const indexOfType = (events, type) => events.findIndex((e) => e.type === type);
const textOf = (events) => events
  .filter((e) => e.type === "content_block_delta" && e.delta?.type === "text_delta")
  .map((e) => e.delta.text)
  .join("");

// Drive the translate-mode transform + flush directly (the level the ticket was
// reproduced at): targetFormat = upstream format, sourceFormat = client format.
async function runTransform(targetFormat, sourceFormat, input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(input)); controller.close(); },
  });
  const reader = stream
    .pipeThrough(createSSETransformStreamWithLogger(targetFormat, sourceFormat, "probe", null, null, MODEL))
    .getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Full wire path: a Claude client (`/v1/messages`) against a chat-native upstream.
const anthropicBody = (stream) => ({
  model: `${PROVIDER}/${MODEL}`,
  max_tokens: 64,
  messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }],
  stream,
});

async function streamMessagesViaClaudeClient({ upstream, responseFormat }) {
  executorStub.execute.mockImplementation(async ({ body }) => ({
    response: upstream,
    url: "https://opencode.ai/zen/v1/x",
    headers: { "content-type": upstream.headers.get("content-type") },
    transformedBody: body,
    responseFormat,
  }));

  const body = anthropicBody(true);
  const result = await handleChatCore({
    body,
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: {},
    clientRawRequest: {
      endpoint: "/v1/messages",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body,
    },
    stream: true,
    sourceFormatOverride: FORMATS.CLAUDE,
  });
  return result.response.text();
}

describe("DF-9ROUTER-21 — Claude streaming terminator", () => {
  it("terminates a chat-native stream that closes without a finish_reason chunk", async () => {
    const body = await runTransform(FORMATS.OPENAI, FORMATS.CLAUDE, CHAT_NO_FINISH_SSE);
    const events = claudeEvents(body);

    // Content survived the translation.
    expect(textOf(events)).toBe("DOGFOOD_OK");

    // Exactly one terminal sequence, with the documented event order.
    expect(countType(events, "message_delta")).toBe(1);
    expect(countType(events, "message_stop")).toBe(1);
    expect(indexOfType(events, "message_stop")).toBe(events.length - 1);
    expect(indexOfType(events, "message_delta")).toBeLessThan(indexOfType(events, "message_stop"));

    const delta = events.find((e) => e.type === "message_delta");
    expect(delta.delta.stop_reason).toBe("end_turn");
    expect(delta.usage).toEqual({ input_tokens: 0, output_tokens: 0 });

    // The open text block is closed before the message ends.
    expect(countType(events, "content_block_stop")).toBe(1);
    expect(indexOfType(events, "content_block_stop")).toBeLessThan(indexOfType(events, "message_delta"));

    // A Claude client never gets the OpenAI sentinel.
    expect(body).not.toContain(SENTINEL);
  });

  it("does not duplicate the terminal when the upstream sends finish_reason", async () => {
    const body = await runTransform(FORMATS.OPENAI, FORMATS.CLAUDE, CHAT_WITH_FINISH_SSE);
    const events = claudeEvents(body);

    expect(textOf(events)).toBe("DOGFOOD_OK");
    // The latch: exactly one message_stop even though the upstream finished AND
    // the flush call ran afterwards.
    expect(countType(events, "message_stop")).toBe(1);
    expect(countType(events, "message_delta")).toBe(1);
    expect(countType(events, "content_block_stop")).toBe(1);
    expect(events.find((e) => e.type === "message_delta").delta.stop_reason).toBe("end_turn");
  });

  it("flushes buffered tool args and closes tool blocks when the stream ends mid-tool_use", async () => {
    const body = await runTransform(FORMATS.OPENAI, FORMATS.CLAUDE, CHAT_TOOL_NO_FINISH_SSE);
    const events = claudeEvents(body);

    expect(textOf(events)).toBe("Checking");
    // Both blocks (text + tool_use) closed, in block order, before the terminal.
    const stops = events.filter((e) => e.type === "content_block_stop").map((e) => e.index);
    expect(stops).toEqual([0, 1]);
    expect(indexOfType(events, "message_delta")).toBeGreaterThan(events.lastIndexOf(stops[1]));

    const toolStart = events.find((e) => e.type === "content_block_start" && e.content_block?.type === "tool_use");
    expect(toolStart).toBeTruthy();
    expect(toolStart.content_block.name).toBe("Read");

    // Args went through the existing sanitize path (string limit → number, capped).
    const argDelta = events.find((e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(argDelta).toBeTruthy();
    expect(JSON.parse(argDelta.delta.partial_json)).toEqual({ file_path: "/tmp/probe.txt", limit: 2000 });

    expect(countType(events, "message_stop")).toBe(1);
  });

  it("terminates a chat-native stream on the real /v1/messages wire path", async () => {
    const body = await streamMessagesViaClaudeClient({
      upstream: sseResponse(CHAT_NO_FINISH_SSE),
      responseFormat: FORMATS.OPENAI,
    });
    const events = claudeEvents(body);

    expect(textOf(events)).toBe("DOGFOOD_OK");
    expect(countType(events, "message_stop")).toBe(1);
    expect(events.find((e) => e.type === "message_delta").delta.stop_reason).toBe("end_turn");
    expect(body).not.toContain(SENTINEL);
  });

  it("terminates a Claude client behind an upstream whose own translator has no flush terminal (gemini)", async () => {
    // gemini→openai answers null for the flush chunk, so the termination here
    // comes from the client-format clause in stream.js.
    const body = await runTransform(FORMATS.GEMINI, FORMATS.CLAUDE, GEMINI_NO_FINISH_SSE);
    const events = claudeEvents(body);

    expect(textOf(events)).toBe("DOGFOOD_OK");
    expect(countType(events, "message_delta")).toBe(1);
    expect(countType(events, "message_stop")).toBe(1);
    expect(countType(events, "content_block_stop")).toBe(1);
    expect(indexOfType(events, "message_stop")).toBe(events.length - 1);
  });

  it("stays silent when no Claude message ever started", () => {
    // Nothing was forwarded to the client, so there is nothing to terminate —
    // a message_delta without a message_start would be a malformed stream.
    const state = initState(FORMATS.CLAUDE);
    expect(openaiToClaudeResponse(null, state)).toBeNull();
    expect(state.messageStartSent).toBeFalsy();
  });
});
