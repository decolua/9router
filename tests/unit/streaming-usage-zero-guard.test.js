// DF-9ROUTER-33 — a streaming completion that produced content recorded NOTHING.
//
// Dogfood 2026-09-20 (docs/dogfood/2026-09-20-integration.md §P0 DF-9ROUTER-33),
// reproduced on a fresh install as a controlled row count on ONE instance:
//
//   rows before    = 1
//   stream:true    -> 2
//   stream omitted -> 2   (NO ROW)
//   stream:false   -> 3
//
// The server printed `📊 DONE … IN 0 · OUT 0` while the client measured
// `prompt_tokens 2592 / completion_tokens 105`, so `usageHistory` stayed at zero
// rows and `GET /api/usage/stats?period=7d` reported nothing for a box that had
// served twelve completions. The README sells quota tracking ("use every bit
// before reset"); it silently reported nothing.
//
// Two independent holes, one defect class ("a successful completion that produced
// content is not recorded"):
//
//   1. `open-sse/utils/stream.js` finalizeStream() estimated usage only when
//      `!hasValidUsage(finalUsage) && totalContentLength > 0`. `hasValidUsage()`
//      treats an ALL-ZERO usage object as invalid but the code kept that 0/0
//      object as `finalUsage` and handed it downstream, so nothing was estimated;
//      the record then reached the DB layer as 0/0 and its all-zero guard dropped
//      it. A Responses-API passthrough stream (codex — `forceStream: true`,
//      `format: openai-responses`) is the live case: it carries no accumulated
//      content length on the passthrough path, so `onStreamComplete` was called
//      with a null usage and the row never landed while the client got its answer.
//   2. `open-sse/handlers/chatCore/requestDetail.js` bailed with a bare
//      `if (inTokens === 0 && outTokens === 0) return;` — the silent skip the
//      dogfood report names.
//
// The contract these tests pin: a streaming completion that produced content is
// RECORDED with an estimate marked `estimated: true` (never silently dropped, and
// never fabricated for an empty response), the all-zero skip is named on stderr,
// and a provider that reports real counts is still recorded verbatim.
//
// The executor is the only stub; everything else is the real wire path
// (handleChatCore → streamingHandler → stream.js finalizeStream → saveUsageStats).
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
    provider: "codex",
    noAuth: true,
    execute: executorStub.execute,
    refreshCredentials: async () => null,
  }),
}));

// Temp DATA_DIR so anything that does reach for state lands in a sandbox.
const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-stream-usage-zero-"));
process.env.DATA_DIR = tempDir;
vi.resetModules();

const usageDb = await import("@/lib/usageDb.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { PROVIDERS } = await import("../../open-sse/config/providers.js");
const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const PROVIDER = "codex";
const MODEL = "gpt-5.6-sol";

beforeEach(() => {
  vi.clearAllMocks();
});

// --- upstream wire shapes ----------------------------------------------------

const sse = (text, contentType = "text/event-stream") => {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status: 200, headers: { "content-type": contentType } });
};

const chunkBase = { id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: MODEL };
const chunk = (delta, finishReason = null) => ({ ...chunkBase, choices: [{ index: 0, delta, finish_reason: finishReason }] });
const line = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

// OpenAI-compatible upstream: content + finish_reason but NO usage chunk.
const CHAT_CONTENT_NO_USAGE = [
  line(chunk({ role: "assistant", content: "DOGFOOD_" })),
  line(chunk({ content: "OK" })),
  line(chunk({}, "stop")),
  "data: [DONE]\n\n",
].join("");

// …and the same stream with an ALL-ZERO usage chunk (an upstream that reports the
// key but no counts — the shape the finalize guard used to hand downstream).
const CHAT_CONTENT_ZERO_USAGE = [
  line(chunk({ role: "assistant", content: "DOGFOOD_" })),
  line(chunk({ content: "OK" })),
  line({ ...chunk({}, "stop"), usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }),
  "data: [DONE]\n\n",
].join("");

// …and with the upstream's real counts, which must survive verbatim.
const CHAT_CONTENT_REAL_USAGE = [
  line(chunk({ role: "assistant", content: "DOGFOOD_" })),
  line(chunk({ content: "OK" })),
  line({ ...chunk({}, "stop"), usage: { prompt_tokens: 2592, completion_tokens: 105, total_tokens: 2697 } }),
  "data: [DONE]\n\n",
].join("");

// Responses API (codex) SSE that never reports usage.
const RESPONSES_CONTENT_NO_USAGE = [
  'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}\n\n',
  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_0","delta":"DOGFOOD_"}\n\n',
  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_0","delta":"OK"}\n\n',
  'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}\n\n',
].join("");

// An empty completion: no content and no counts. Must NOT invent traffic.
const CHAT_EMPTY_NO_USAGE = [
  line(chunk({ role: "assistant", content: "" })),
  line(chunk({}, "stop")),
  "data: [DONE]\n\n",
].join("");

// Native Gemini streamGenerateContent SSE: content chunks, then a terminal
// chunk carrying `usageMetadata` (no OpenAI `usage` key anywhere) — the shape
// the DF-9ROUTER-39-R2 dogfood served. `promptTokenCount` is the billed count
// the upstream reports.
const geminiEvent = (obj) => line({ modelVersion: MODEL, responseId: "gem-probe", ...obj });
const GEMINI_STREAM_WITH_USAGE = [
  geminiEvent({ candidates: [{ content: { role: "model", parts: [{ text: "DOGFOOD_" }] }, index: 0 }] }),
  geminiEvent({ candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, index: 0 }] }),
  geminiEvent({
    candidates: [{ content: { role: "model", parts: [{ text: "" }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 2009, candidatesTokenCount: 2, cachedContentTokenCount: 512, totalTokenCount: 2011 },
  }),
  "data: [DONE]\n\n",
].join("");

// --- driver -----------------------------------------------------------------

async function streamCompletion({ upstreamText, upstreamContentType = "text/event-stream", responseFormat, streamKey = true }) {
  executorStub.execute.mockImplementation(async ({ body: sent }) => ({
    response: sse(upstreamText, upstreamContentType),
    url: "https://probe.invalid/v1/chat/completions",
    headers: { "content-type": upstreamContentType },
    transformedBody: sent,
    responseFormat,
  }));

  const body = { model: `${PROVIDER}/${MODEL}`, messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }] };
  if (streamKey !== undefined) body.stream = streamKey;

  const result = await handleChatCore({
    body,
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: {},
    clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body },
  });
  return { result, text: await result.response.text() };
}

const recordedUsage = () => usageDb.saveRequestUsage.mock.calls[0]?.[0];
const openaiContent = (text) => text
  .split("\n")
  .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
  .map((l) => { try { return JSON.parse(l.slice(6))?.choices?.[0]?.delta?.content || ""; } catch { return ""; } })
  .join("");

describe("DF-9ROUTER-33 — a streaming completion that produced content is recorded", () => {
  it("records an ESTIMATED row for a chat stream that sends content and no usage chunk", async () => {
    const { result, text } = await streamCompletion({
      upstreamText: CHAT_CONTENT_NO_USAGE,
      responseFormat: FORMATS.OPENAI,
    });

    // The completion really succeeded and reached the client.
    expect(result.success).toBe(true);
    expect(openaiContent(text)).toBe("DOGFOOD_OK");

    const entry = recordedUsage();
    expect(usageDb.saveRequestUsage, "no usage row was written for a served completion").toHaveBeenCalledTimes(1);
    expect(entry.provider).toBe(PROVIDER);
    expect(entry.model).toBe(MODEL);
    expect(entry.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(entry.tokens.completion_tokens).toBeGreaterThan(0);
    // The marker must survive canonicalizeUsage on the way to the DB.
    expect(entry.tokens.estimated).toBe(true);
  });

  it("records an ESTIMATED row when the upstream sends an ALL-ZERO usage chunk", async () => {
    const { result, text } = await streamCompletion({
      upstreamText: CHAT_CONTENT_ZERO_USAGE,
      responseFormat: FORMATS.OPENAI,
    });

    expect(result.success).toBe(true);
    expect(openaiContent(text)).toBe("DOGFOOD_OK");

    const entry = recordedUsage();
    expect(usageDb.saveRequestUsage, "an all-zero usage chunk must not swallow the row").toHaveBeenCalledTimes(1);
    expect(entry.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(entry.tokens.completion_tokens).toBeGreaterThan(0);
    expect(entry.tokens.estimated).toBe(true);
  });

  it("records an ESTIMATED row for a Responses-API passthrough stream with no usage", async () => {
    // The live codex shape: `forceStream: true` + Responses-API framing, so the
    // request is streamed upstream regardless of the client and no usage chunk
    // ever arrives. The client still gets the answer.
    expect(PROVIDERS[PROVIDER]?.forceStream).toBe(true);
    expect(PROVIDERS[PROVIDER]?.format).toBe(FORMATS.OPENAI_RESPONSES);

    const { result, text } = await streamCompletion({
      upstreamText: RESPONSES_CONTENT_NO_USAGE,
      responseFormat: FORMATS.OPENAI_RESPONSES,
    });

    expect(result.success).toBe(true);
    expect(text).toContain("DOGFOOD_");

    const entry = recordedUsage();
    expect(usageDb.saveRequestUsage, "a Responses passthrough stream recorded nothing").toHaveBeenCalledTimes(1);
    expect(entry.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(entry.tokens.completion_tokens).toBeGreaterThan(0);
    expect(entry.tokens.estimated).toBe(true);
  });

  it("still records the upstream's OWN counts un-estimated when it reports them", async () => {
    const { result, text } = await streamCompletion({
      upstreamText: CHAT_CONTENT_REAL_USAGE,
      responseFormat: FORMATS.OPENAI,
    });

    expect(result.success).toBe(true);
    expect(openaiContent(text)).toBe("DOGFOOD_OK");

    const entry = recordedUsage();
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(entry.tokens.prompt_tokens).toBe(2592);
    expect(entry.tokens.completion_tokens).toBe(105);
    expect(entry.tokens.estimated).toBeFalsy();
  });

  it("records a Gemini stream's usageMetadata as the upstream's own counts (DF-9ROUTER-39-R2)", async () => {
    // Dogfood 2026-10-23 saw a Gemini stream SERVED with prompt_tokens 2009
    // while the ledger recorded 9, and read it as the extractor missing
    // usageMetadata. The real split: stream.js extracts usageMetadata from the
    // raw chunk (usageTracking.js extractUsage) into state.usage and the ledger
    // keeps that count — the SERVED chunk carries the 2000-token
    // context-safety buffer (addBufferToUsage) on top. Pin the ledger side.
    const { result, text } = await streamCompletion({
      upstreamText: GEMINI_STREAM_WITH_USAGE,
      responseFormat: FORMATS.GEMINI,
    });

    expect(result.success).toBe(true);
    expect(openaiContent(text)).toBe("DOGFOOD_OK");

    const entry = recordedUsage();
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(entry.tokens.prompt_tokens).toBe(2009);  // promptTokenCount verbatim, not an estimate
    expect(entry.tokens.completion_tokens).toBe(2); // candidatesTokenCount
    expect(entry.tokens.cached_tokens).toBe(512);   // cachedContentTokenCount
    expect(entry.tokens.estimated).toBeFalsy();
  });

  it("does NOT invent output tokens for a stream with no content and no counts", async () => {
    // A served-but-empty completion still records (the request happened; its
    // prompt was paid for), but with completion_tokens 0 — the estimator's
    // floor-at-1 must not turn "model said nothing" into invented output traffic.
    const { result } = await streamCompletion({
      upstreamText: CHAT_EMPTY_NO_USAGE,
      responseFormat: FORMATS.OPENAI,
    });

    expect(result.success).toBe(true);
    const entry = recordedUsage();
    expect(usageDb.saveRequestUsage, "the empty completion must still be accounted for").toHaveBeenCalledTimes(1);
    expect(entry.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(entry.tokens.completion_tokens).toBe(0);
    expect(entry.tokens.estimated).toBe(true);
  });
});

describe("DF-9ROUTER-33 — the all-zero skip is never silent", () => {
  it("warns with provider and model instead of dropping a 0/0 record quietly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      saveUsageStats({
        provider: "probe-provider",
        model: "probe-model",
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        connectionId: "1234567890abcdef",
        label: "STREAM USAGE",
        silent: true,
        body: { messages: [{ role: "user", content: "hi" }] },
        contentLength: 0,
      });

      // Nothing is written (there is nothing to write)…
      expect(usageDb.saveRequestUsage).not.toHaveBeenCalled();
      // …but the skip is named, with the provider and model, so the accounting
      // hole is visible in the server log instead of looking like a quiet success.
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0];
      expect(message).toContain("probe-provider");
      expect(message).toContain("probe-model");
      expect(message).toContain("all-zero");
    } finally {
      warn.mockRestore();
    }
  });
});
