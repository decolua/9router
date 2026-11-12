// DF-9ROUTER-22 — the synthetic `data: [DONE]` in PASSTHROUGH mode is an
// OpenAI-client terminator, not a universal one.
//
// stream.js's passthrough flush appends `data: [DONE]` for every client unless
// the provider is gemini-family (the OpenClaw-hang workaround: an OpenAI-shape
// client that never sees the sentinel can hang until timeout and trigger
// failover). It was never gated on the CLIENT format. An Anthropic client
// (`/v1/messages`, sourceFormat === "claude") talking to a claude-native
// upstream in passthrough mode therefore received the upstream's own
// `message_stop` terminal PLUS our extra `data: [DONE]` — the Anthropic
// contract terminates on message_stop, so the trailing OpenAI sentinel is a
// malformed stream end.
//
// The gate belongs on the client format, because passthrough means
// client format === upstream format: an OpenAI client on an OpenAI-native
// upstream keeps the hang workaround, a Claude client on a Claude-native
// upstream ends on message_stop, and the gemini-family gate stays as-is.
//
// These tests drive the real wire path (handleChatCore → streamingHandler →
// buildTransformStream → stream.js), not a translator unit: the executor is the
// only stub.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

const executorStub = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    provider: "probe",
    noAuth: true,
    execute: executorStub.execute,
    refreshCredentials: async () => null,
  }),
}));

// Temp DATA_DIR + a fresh module registry so the handlers under test resolve
// their state (usage DB, request logger) into the sandbox, never ~/.9router.
const originalDataDir = process.env.DATA_DIR;
let tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-passthrough-done-"));
process.env.DATA_DIR = tempDir;
vi.resetModules();

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");

const SENTINEL = "data: [DONE]";
const MODEL = "muse-spark-1.2-contributor-free";

const sentinelCount = (body) => body.split(SENTINEL).length - 1;

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// --- upstream wire shapes ----------------------------------------------------

// Claude-native upstream: streams content and closes with its own terminal.
// Passthrough must forward this and add NOTHING.
const CLAUDE_SSE = [
  "event: message_start",
  'data: {"type":"message_start","message":{"id":"msg_probe","type":"message","role":"assistant","model":"claude-probe","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":15,"output_tokens":1}}}',
  "",
  "event: content_block_start",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"DOGFOOD_"}}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}',
  "",
  "event: content_block_stop",
  'data: {"type":"content_block_stop","index":0}',
  "",
  "event: message_delta",
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
  "",
  "event: message_stop",
  'data: {"type":"message_stop"}',
  "",
].join("\n");

// Chat-native upstream that closes WITHOUT the sentinel (the OpenClaw-hang
// shape the workaround exists for).
const OPENAI_NO_DONE_SSE = [
  'data: {"id":"chatcmpl-probe","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"DOGFOOD_"},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-probe","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-probe","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":15,"completion_tokens":2,"total_tokens":17}}',
  "",
].join("\n");

// Same upstream, but it sends its own sentinel — must arrive exactly once.
const OPENAI_WITH_DONE_SSE = `${OPENAI_NO_DONE_SSE}${SENTINEL}\n\n`;

// Gemini-format upstream (gemini-family gate, unchanged by this fix).
const GEMINI_SSE = [
  'data: {"candidates":[{"index":0,"content":{"parts":[{"text":"DOGFOOD_"}],"role":"model"}}],"modelVersion":"gemini-probe"}',
  "",
  'data: {"candidates":[{"index":0,"content":{"parts":[{"text":"OK"}],"role":"model"},"finishReason":"STOP"}],"modelVersion":"gemini-probe"}',
  "",
].join("\n");

function sseResponse(text) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

// --- drivers -----------------------------------------------------------------

// Full wire path: chatCore → streamingHandler → buildTransformStream → stream.js.
// `responseFormat` is what the executor reports the upstream speaks, which is
// what selects the passthrough stream (client format === upstream format).
async function streamViaWire({ provider, model, body, upstream, responseFormat, endpoint = "/v1/chat/completions", headers = { "content-type": "application/json" }, sourceFormatOverride = null }) {
  executorStub.execute.mockImplementation(async ({ body: sent }) => ({
    response: upstream,
    url: `https://probe.invalid/${provider}/v1/x`,
    headers: { "content-type": upstream.headers.get("content-type") },
    transformedBody: sent,
    responseFormat,
  }));

  const result = await handleChatCore({
    body,
    modelInfo: { provider, model },
    credentials: {},
    clientRawRequest: { endpoint, headers, body },
    stream: true,
    ...(sourceFormatOverride ? { sourceFormatOverride } : {}),
  });
  return result.response.text();
}

// Stream level: the passthrough flush itself (no handler wiring in between).
async function runPassthroughStream(provider, sourceFormat, input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(input)); controller.close(); },
  });
  const reader = stream
    .pipeThrough(createPassthroughStreamWithLogger(provider, null, MODEL, null, null, null, null, sourceFormat))
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

// --- body/response readers ---------------------------------------------------

const dataLines = (body) => body
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("data:"));

const jsonEvents = (body) => dataLines(body)
  .map((l) => l.slice(5).trim())
  .filter((p) => p && p !== "[DONE]")
  .map((p) => { try { return JSON.parse(p); } catch { return null; } })
  .filter(Boolean);

const claudeText = (body) => jsonEvents(body)
  .filter((e) => e.type === "content_block_delta" && e.delta?.type === "text_delta")
  .map((e) => e.delta.text)
  .join("");

const openaiText = (body) => jsonEvents(body)
  .map((e) => e.choices?.[0]?.delta?.content || "")
  .join("");

const geminiText = (body) => jsonEvents(body)
  .flatMap((e) => e.candidates?.[0]?.content?.parts || [])
  .map((p) => p.text || "")
  .join("");

const anthropicBody = () => ({
  model: `anthropic/claude-sonnet-4-20250514`,
  max_tokens: 64,
  messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }],
  stream: true,
});

const openaiBody = () => ({
  model: `openai/gpt-5.4`,
  messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }],
  stream: true,
});

const geminiBody = () => ({
  model: `gemini/gemini-3.8-flash`,
  contents: [{ role: "user", parts: [{ text: "Reply with exactly: DOGFOOD_OK" }] }],
  stream: true,
});

describe("DF-9ROUTER-22 — passthrough [DONE] sentinel is OpenAI-client-only", () => {
  // (a) Claude client + claude-native passthrough upstream.
  it("(a) emits NO synthetic sentinel for a Claude-format client and forwards the upstream message_stop", async () => {
    const body = await streamViaWire({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      body: anthropicBody(),
      upstream: sseResponse(CLAUDE_SSE),
      responseFormat: FORMATS.CLAUDE,
      endpoint: "/v1/messages",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      sourceFormatOverride: FORMATS.CLAUDE,
    });

    // The real terminal is forwarded verbatim...
    expect(body).toContain("message_stop");
    expect(jsonEvents(body).some((e) => e.type === "message_stop")).toBe(true);
    expect(claudeText(body)).toBe("DOGFOOD_OK");

    // ...and the OpenAI sentinel is not appended to it.
    expect(sentinelCount(body)).toBe(0);
    expect(body).not.toContain(SENTINEL);
  });

  it("(a2) the passthrough flush itself suppresses the sentinel for a Claude sourceFormat", async () => {
    const body = await runPassthroughStream("anthropic", FORMATS.CLAUDE, CLAUDE_SSE);

    expect(sentinelCount(body)).toBe(0);
    expect(body).toContain("message_stop");
    expect(claudeText(body)).toBe("DOGFOOD_OK");
  });

  // (b) OpenAI client, upstream closes without the sentinel: hang workaround intact.
  it("(b) still emits exactly one sentinel for an OpenAI client when the upstream sends none", async () => {
    const body = await streamViaWire({
      provider: "openai",
      model: "gpt-5.4",
      body: openaiBody(),
      upstream: sseResponse(OPENAI_NO_DONE_SSE),
      responseFormat: FORMATS.OPENAI,
    });

    expect(sentinelCount(body)).toBe(1);
    expect(body.trimEnd().endsWith(SENTINEL)).toBe(true);
    expect(openaiText(body)).toBe("DOGFOOD_OK");
  });

  // (c) OpenAI client, upstream sends its own sentinel: exactly-once latch.
  it("(c) does not duplicate the sentinel when an OpenAI passthrough upstream sends its own", async () => {
    const body = await streamViaWire({
      provider: "openai",
      model: "gpt-5.4",
      body: openaiBody(),
      upstream: sseResponse(OPENAI_WITH_DONE_SSE),
      responseFormat: FORMATS.OPENAI,
    });

    expect(sentinelCount(body)).toBe(1);
    expect(openaiText(body)).toBe("DOGFOOD_OK");
  });

  // (d) gemini-family provider gate is untouched.
  it("(d) emits no sentinel for a gemini-family passthrough provider", async () => {
    const body = await streamViaWire({
      provider: "gemini",
      model: "gemini-3.8-flash",
      body: geminiBody(),
      upstream: sseResponse(GEMINI_SSE),
      responseFormat: FORMATS.GEMINI,
      sourceFormatOverride: FORMATS.GEMINI,
    });

    expect(sentinelCount(body)).toBe(0);
    expect(geminiText(body)).toBe("DOGFOOD_OK");
  });

  it("(d2) the passthrough flush itself keeps the gemini-family gate", async () => {
    const body = await runPassthroughStream("gemini", FORMATS.GEMINI, GEMINI_SSE);

    expect(sentinelCount(body)).toBe(0);
    expect(geminiText(body)).toBe("DOGFOOD_OK");
  });
});
