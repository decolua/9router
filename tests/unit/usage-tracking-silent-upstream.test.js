// DF-9ROUTER-26 — a successful completion whose upstream omits token counts was
// recorded NOWHERE.
//
// Dogfood 2026-09-16: the server logged `📊 DONE … IN 0 · OUT 0` across four
// successful completions while `usageHistory` / `usageDaily` /
// `totalRequestsLifetime` stayed at zero rows, so `/api/usage/stats` and the
// dashboard Usage page were empty even though every request answered 200. The
// headline feature ("Track quota, use every bit before reset") reported nothing.
//
// Two independent holes, one defect class ("upstream silent about tokens →
// request disappears"):
//
//   1. Non-streaming: `extractUsageFromResponse()` understood Claude/Responses
//      (`usage.input_tokens`), OpenAI (`usage.prompt_tokens`) and Gemini
//      (`usageMetadata`) — but a NATIVE OLLAMA body
//      `{message:{role,content}, done:true, prompt_eval_count, eval_count}`
//      matches none of them, so it returned null. `saveUsageStats()` then bailed
//      on its "no tokens" guard. The streaming extractor
//      (`extractUsage()` in open-sse/utils/usageTracking.js) already knew the
//      Ollama shape; the non-streaming one did not.
//   2. Streaming translate branch: `stream.js` accumulated output length for
//      Claude (`delta.text`), OpenAI (`choices[].delta.content`) and Gemini
//      (`candidates[].parts`) chunks only, so an Ollama-native NDJSON chunk
//      (`parsed.message.content`) contributed 0 chars and the existing estimate
//      fallback (`estimateUsage(body, totalContentLength, …)`) never fired —
//      an upstream that omits counts produced 0/0 and was dropped.
//
// The contract these tests pin: the request is RECORDED and the tokens are
// ESTIMATED (marked `estimated: true`) when the upstream is silent — never
// fabricated for an empty response (case d).
//
// Cases (b)/(c)/(d) drive the real wire path (handleChatCore →
// nonStreamingHandler / handleStreamingResponse → stream.js); the executor is
// the only stub.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterAll, beforeEach, vi } from "vitest";

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

// Temp DATA_DIR so anything that does reach for state lands in a sandbox.
const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-silent-usage-"));
process.env.DATA_DIR = tempDir;
vi.resetModules();

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { extractUsageFromResponse } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");
const usageDb = await import("@/lib/usageDb.js");

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(() => {
  vi.clearAllMocks();
});

const PROVIDER = "ollama-local";
const MODEL = "gemma3:4b";

// --- upstream wire shapes ----------------------------------------------------

// Native Ollama non-streaming (`POST /api/chat` with stream:false). The counts
// ride on the TOP-LEVEL body, next to `message` — not under `usage`.
const ollamaChatBody = ({ content = "DOGFOOD_OK", counts = true } = {}) => ({
  model: MODEL,
  created_at: "2026-09-16T00:00:00Z",
  message: { role: "assistant", content },
  done: true,
  done_reason: "stop",
  ...(counts ? { prompt_eval_count: 11, eval_count: 7 } : {}),
});

// Native Ollama /api/generate shape (same top-level counts, `response` instead
// of `message`).
const ollamaGenerateBody = ({ content = "DOGFOOD_OK", counts = true } = {}) => ({
  model: MODEL,
  response: content,
  done: true,
  ...(counts ? { prompt_eval_count: 5, eval_count: 3 } : {}),
});

// NDJSON streaming chunk (`POST /api/chat` with stream:true).
const ndjsonChunk = (content, extra = {}) => JSON.stringify({
  model: MODEL,
  created_at: "2026-09-16T00:00:00Z",
  message: { role: "assistant", content },
  done: false,
  ...extra,
});

const OLLAMA_STREAM_SILENT = [
  ndjsonChunk("DOGFOOD_"),
  ndjsonChunk("OK_SILENT"),
  ndjsonChunk("", { done: true, done_reason: "stop" }),
].join("\n") + "\n";

const OLLAMA_STREAM_WITH_COUNTS = [
  ndjsonChunk("DOGFOOD_"),
  ndjsonChunk("OK", { done: true, done_reason: "stop", prompt_eval_count: 11, eval_count: 7 }),
].join("\n") + "\n";

const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { "content-type": "application/json" },
});

const ndjsonResponse = (text) => {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status: 200, headers: { "content-type": "application/x-ndjson" } });
};

// --- drivers -----------------------------------------------------------------

const clientBody = (stream) => ({
  model: `${PROVIDER}/${MODEL}`,
  messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }],
  stream,
});

// Non-streaming: the real wire path chatCore takes for `stream:false`.
// `responseFormat` is what the executor reports the UPSTREAM answered in.
async function nonStreamingViaWire({ upstream, body = clientBody(false), responseFormat = FORMATS.OLLAMA }) {
  executorStub.execute.mockImplementation(async ({ body: sent }) => ({
    response: upstream,
    url: `https://probe.invalid/${PROVIDER}/api/chat`,
    headers: { "content-type": upstream.headers.get("content-type") },
    transformedBody: sent,
    responseFormat,
  }));

  const result = await handleChatCore({
    body,
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: {},
    clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body },
    stream: false,
  });
  return { status: result.response.status, text: await result.response.text() };
}

// Streaming, full wire path: chatCore builds onStreamComplete → saveUsageStats →
// saveRequestUsage — the row the dogfood report found missing.
async function streamingViaWire({ upstream, body = clientBody(true) }) {
  executorStub.execute.mockImplementation(async ({ body: sent }) => ({
    response: upstream,
    url: `https://probe.invalid/${PROVIDER}/api/chat`,
    headers: { "content-type": upstream.headers.get("content-type") },
    transformedBody: sent,
    responseFormat: FORMATS.OLLAMA,
  }));

  const result = await handleChatCore({
    body,
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: {},
    clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body },
    stream: true,
  });
  return { status: result.response.status, text: await result.response.text() };
}

// Streaming: handleStreamingResponse is the function chatCore calls with the
// stream it built; an own onStreamComplete spy is how usage becomes observable.
async function streamViaHandler({ upstream, body = clientBody(true), onStreamComplete }) {
  const streamController = createStreamController({ provider: PROVIDER, model: MODEL });
  return handleStreamingResponse({
    providerResponse: upstream,
    provider: PROVIDER,
    model: MODEL,
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OLLAMA,
    userAgent: "probe/1.0",
    body,
    stream: true,
    translatedBody: null,
    finalBody: body,
    requestStartTime: Date.now(),
    connectionId: null,
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body },
    onRequestSuccess: null,
    reqLogger: null,
    toolNameMap: null,
    customToolNames: null,
    streamController,
    onStreamComplete,
    streamDetailId: null,
    pxpipe: null,
    reqTag: "probe",
    log: null,
    credentials: {},
  });
}

// --- readers -----------------------------------------------------------------

const recordedUsage = () => usageDb.saveRequestUsage.mock.calls[0]?.[0];

const openaiText = (body) => body
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("data:"))
  .map((l) => l.slice(5).trim())
  .filter((p) => p && p !== "[DONE]")
  .map((p) => { try { return JSON.parse(p); } catch { return null; } })
  .filter(Boolean)
  .map((e) => e.choices?.[0]?.delta?.content || "")
  .join("");

describe("DF-9ROUTER-26 (a) — extractUsageFromResponse knows the native Ollama shape", () => {
  it("returns the real counts of a native Ollama /api/chat non-streaming body", () => {
    const usage = extractUsageFromResponse(ollamaChatBody());
    expect(usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 7 });
  });

  it("returns the real counts of a native Ollama /api/generate body", () => {
    const usage = extractUsageFromResponse(ollamaGenerateBody());
    expect(usage).toMatchObject({ prompt_tokens: 5, completion_tokens: 3 });
  });

  it("stays null when an Ollama body omits the counts (the estimate, not this, covers that)", () => {
    expect(extractUsageFromResponse(ollamaChatBody({ counts: false }))).toBeNull();
    expect(extractUsageFromResponse(ollamaGenerateBody({ counts: false }))).toBeNull();
  });

  it("requires a NUMERIC count and done:true, like the streaming extractor", () => {
    expect(extractUsageFromResponse({ message: { content: "hi" }, done: true, prompt_eval_count: "11", eval_count: 7 })).toBeNull();
    expect(extractUsageFromResponse({ message: { content: "hi" }, prompt_eval_count: 11, eval_count: 7 })).toBeNull();
  });

  it("still reads the Claude / OpenAI / Gemini shapes", () => {
    expect(extractUsageFromResponse({ usage: { input_tokens: 10, output_tokens: 2 } }))
      .toMatchObject({ prompt_tokens: 10, completion_tokens: 2 });
    expect(extractUsageFromResponse({ usage: { prompt_tokens: 10, completion_tokens: 2 } }))
      .toMatchObject({ prompt_tokens: 10, completion_tokens: 2 });
    expect(extractUsageFromResponse({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } }))
      .toMatchObject({ prompt_tokens: 10, completion_tokens: 2 });
  });
});

describe("DF-9ROUTER-26 (b) — a silent non-streaming completion is still recorded", () => {
  it("persists an ESTIMATED usage for a native Ollama body with no counts", async () => {
    const content = "DOGFOOD_OK_SILENT_RECORDED";
    const { status, text } = await nonStreamingViaWire({
      upstream: jsonResponse(ollamaChatBody({ content, counts: false })),
    });

    // The completion really succeeded — the client got its content.
    expect(status).toBe(200);
    expect(JSON.parse(text).choices[0].message.content).toBe(content);

    const entry = recordedUsage();
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(entry.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(entry.tokens.completion_tokens).toBeGreaterThan(0);
    expect(entry.tokens.estimated).toBe(true);
    expect(entry.provider).toBe(PROVIDER);
    expect(entry.model).toBe(MODEL);
  });

  it("persists an ESTIMATED usage for an OpenAI-shaped body with no `usage`", async () => {
    const { status, text } = await nonStreamingViaWire({
      responseFormat: FORMATS.OPENAI,
      upstream: jsonResponse({
        id: "chatcmpl-probe",
        object: "chat.completion",
        model: MODEL,
        choices: [{ index: 0, message: { role: "assistant", content: "DOGFOOD_OK_SILENT_RECORDED" }, finish_reason: "stop" }],
      }),
    });

    expect(status).toBe(200);
    expect(JSON.parse(text).choices[0].message.content).toBe("DOGFOOD_OK_SILENT_RECORDED");

    const entry = recordedUsage();
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(entry.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(entry.tokens.completion_tokens).toBeGreaterThan(0);
    expect(entry.tokens.estimated).toBe(true);
  });

  it("records the upstream's OWN counts un-estimated when it reports them", async () => {
    const { status } = await nonStreamingViaWire({ upstream: jsonResponse(ollamaChatBody()) });

    expect(status).toBe(200);
    const entry = recordedUsage();
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(entry.tokens.prompt_tokens).toBe(11);
    expect(entry.tokens.completion_tokens).toBe(7);
    expect(entry.tokens.estimated).toBeFalsy();
  });
});

describe("DF-9ROUTER-26 (c) — a silent streaming completion yields estimated usage", () => {
  it("reports non-zero estimated usage on onStreamComplete for NDJSON without counts", async () => {
    const onStreamComplete = vi.fn();
    const result = await streamViaHandler({
      upstream: ndjsonResponse(OLLAMA_STREAM_SILENT),
      onStreamComplete,
    });
    const text = await result.response.text();

    // The stream really succeeded and reached the client.
    expect(openaiText(text)).toBe("DOGFOOD_OK_SILENT");
    expect(text).toContain("data: [DONE]");

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    const [contentObj, usage] = onStreamComplete.mock.calls[0];
    expect(contentObj.content).toBe("DOGFOOD_OK_SILENT");
    expect(usage).toBeTruthy();
    expect(usage.prompt_tokens).toBeGreaterThan(0);
    expect(usage.completion_tokens).toBeGreaterThan(0);
    expect(usage.estimated).toBe(true);
  });

  it("prefers the upstream's own counts over the estimate when it reports them", async () => {
    const onStreamComplete = vi.fn();
    const result = await streamViaHandler({
      upstream: ndjsonResponse(OLLAMA_STREAM_WITH_COUNTS),
      onStreamComplete,
    });
    await result.response.text();

    const [, usage] = onStreamComplete.mock.calls[0];
    expect(usage.prompt_tokens).toBe(11);
    expect(usage.completion_tokens).toBe(7);
    expect(usage.estimated).toBeFalsy();
  });

  it("persists the estimated streaming usage to the DB (full wire path)", async () => {
    const { status, text } = await streamingViaWire({ upstream: ndjsonResponse(OLLAMA_STREAM_SILENT) });

    expect(status).toBe(200);
    expect(openaiText(text)).toBe("DOGFOOD_OK_SILENT");

    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    const entry = recordedUsage();
    expect(entry.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(entry.tokens.completion_tokens).toBeGreaterThan(0);
    // The marker must survive canonicalizeUsage on the way to the DB.
    expect(entry.tokens.estimated).toBe(true);
  });
});

describe("DF-9ROUTER-26 (d) — the estimate cannot invent traffic", () => {
  it("records NOTHING for a non-streaming success with no usage and no content", async () => {
    const { status, text } = await nonStreamingViaWire({
      upstream: jsonResponse(ollamaChatBody({ content: "", counts: false })),
    });

    expect(status).toBe(200);
    expect(JSON.parse(text).choices[0].message.content).toBe("");
    expect(usageDb.saveRequestUsage).not.toHaveBeenCalled();
  });

  it("records NOTHING for an empty OpenAI-shaped body with no usage", async () => {
    const { status } = await nonStreamingViaWire({
      responseFormat: FORMATS.OPENAI,
      upstream: jsonResponse({
        id: "chatcmpl-probe",
        object: "chat.completion",
        model: MODEL,
        choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
      }),
    });

    expect(status).toBe(200);
    expect(usageDb.saveRequestUsage).not.toHaveBeenCalled();
  });

  it("records NOTHING for a streaming completion with no usage and no content", async () => {
    const onStreamComplete = vi.fn();
    const result = await streamViaHandler({
      upstream: ndjsonResponse(ndjsonChunk("", { done: true, done_reason: "stop" }) + "\n"),
      onStreamComplete,
    });
    await result.response.text();

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    const [, usage] = onStreamComplete.mock.calls[0];
    expect(usage).toBeFalsy();
    expect(usageDb.saveRequestUsage).not.toHaveBeenCalled();
  });
});
