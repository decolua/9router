// DF-9ROUTER-39 — non-stream usage must record upstream truth; estimates must be flagged.
//
// Dogfood 2026-09-24: the Usage page totals mix measured and estimated rows with
// no way to tell them apart, because the `meta` column of every usageHistory row
// was written as a literal `{}` — the estimated verdict lived (if at all) only
// inside the `tokens` JSON, and nothing pinned the recording contract for the
// non-stream path. These tests pin:
//   (a) a response WITH upstream usage → the row carries the UPSTREAM numbers
//       (canonicalized), meta.estimated === false;
//   (b) a response WITHOUT usage → the estimator fallback is used and the row is
//       flagged estimated in BOTH tokens and meta;
//   (c) the estimator result is never presented as upstream truth — the flag is
//       what distinguishes the two rows;
//   (d) the streaming estimate fallback carries the same flag (it falls out of
//       the shared estimateUsage()/saveUsageStats() helper — stream.js untouched).
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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-nonstream-usage-truth-"));
process.env.DATA_DIR = tempDir;
vi.resetModules();

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
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
const MODEL = "qwen3.8-27b";

// --- upstream wire shapes ----------------------------------------------------

// OpenAI chat.completion non-streaming body. `usage: null` omits the object —
// the "upstream stayed silent about tokens" case the estimator covers.
const openaiCompletionBody = ({ content = "DOGFOOD_OK", usage = { prompt_tokens: 2061, completion_tokens: 41, total_tokens: 2102 } } = {}) => ({
  id: "chatcmpl-probe",
  object: "chat.completion",
  model: MODEL,
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  ...(usage ? { usage } : {}),
});

// Native Ollama NDJSON streaming chunks — the shape whose silent streams fall
// back to the estimator inside stream.js's flush (case d).
const ndjsonChunk = (content, extra = {}) => JSON.stringify({
  model: MODEL,
  created_at: "2026-09-24T00:00:00Z",
  message: { role: "assistant", content },
  done: false,
  ...extra,
});

const OLLAMA_STREAM_SILENT = [
  ndjsonChunk("DOGFOOD_"),
  ndjsonChunk("OK_SILENT"),
  ndjsonChunk("", { done: true, done_reason: "stop" }),
].join("\n") + "\n";

const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { "content-type": "application/json" },
});

// Native Gemini generateContent body: `usageMetadata`, no OpenAI `usage` key —
// the shape the DF-9ROUTER-39-R2 dogfood served. `promptTokenCount` is the
// billed count the upstream reports; it legitimately differs from anything a
// client-side estimator can see (Google counts its own steering).
const geminiCompletionBody = ({ promptTokenCount = 2002, candidatesTokenCount = 1, cachedContentTokenCount = 0, text = "OK" } = {}) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
  usageMetadata: {
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount: promptTokenCount + candidatesTokenCount,
    ...(cachedContentTokenCount > 0 ? { cachedContentTokenCount } : {}),
  },
  modelVersion: MODEL,
  responseId: "gem-probe",
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
async function nonStreamingViaWire({ upstream, body = clientBody(false), responseFormat = FORMATS.OPENAI }) {
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
// saveRequestUsage.
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
  const text = await result.response.text();
  return { status: result.response.status, text };
}

// --- readers -----------------------------------------------------------------

const recordedUsage = () => usageDb.saveRequestUsage.mock.calls[0]?.[0];

// --- (a) upstream usage is recorded as the row's truth ------------------------

describe("DF-9ROUTER-39 (a) — a response WITH upstream usage records the upstream numbers", () => {
  it("stores the upstream OpenAI-shape counts (canonicalized), un-estimated", async () => {
    const { status } = await nonStreamingViaWire({
      upstream: jsonResponse(openaiCompletionBody()),
    });

    expect(status).toBe(200);
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);

    const entry = recordedUsage();
    expect(entry.tokens.prompt_tokens).toBe(2061);
    expect(entry.tokens.completion_tokens).toBe(41);
    expect(entry.tokens.total_tokens).toBe(2102); // canonicalizeUsage recomputes the total
    expect(entry.tokens.estimated).toBeFalsy();   // upstream truth is never flagged estimated
    expect(entry.meta.estimated).toBe(false);     // the row's meta carries the explicit verdict
  });

  it("reads Responses-shape upstream usage (input_tokens) through the same canonicalizer", async () => {
    await nonStreamingViaWire({
      upstream: jsonResponse(openaiCompletionBody({
        usage: { input_tokens: 500, output_tokens: 20, total_tokens: 520 },
      })),
    });

    const entry = recordedUsage();
    expect(entry.tokens.prompt_tokens).toBe(500);
    expect(entry.tokens.completion_tokens).toBe(20);
    expect(entry.tokens.estimated).toBeFalsy();
    expect(entry.meta.estimated).toBe(false);
  });
});

// --- (b) the estimator is fallback-only, and flagged --------------------------

describe("DF-9ROUTER-39 (b) — a response WITHOUT usage falls back to the estimator, flagged", () => {
  it("stores an ESTIMATED row when the upstream stayed silent about tokens", async () => {
    const { status } = await nonStreamingViaWire({
      upstream: jsonResponse(openaiCompletionBody({ content: "x".repeat(164), usage: null })),
    });

    expect(status).toBe(200);
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);

    const entry = recordedUsage();
    expect(entry.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(entry.tokens.completion_tokens).toBeGreaterThan(0);
    expect(entry.tokens.estimated).toBe(true);   // tokens JSON keeps the flag
    expect(entry.meta.estimated).toBe(true);     // meta column carries it too
  });
});

// --- (c) the flag is what separates truth from estimate ----------------------

describe("DF-9ROUTER-39 (c) — the estimator is never presented as upstream truth", () => {
  it("gives the two rows opposite verdicts on the same meta field", async () => {
    await nonStreamingViaWire({ upstream: jsonResponse(openaiCompletionBody()) });
    const truthEntry = recordedUsage();

    vi.clearAllMocks();

    await nonStreamingViaWire({
      upstream: jsonResponse(openaiCompletionBody({ content: "x".repeat(164), usage: null })),
    });
    const estimateEntry = recordedUsage();

    expect(truthEntry.meta.estimated).toBe(false);
    expect(estimateEntry.meta.estimated).toBe(true);
    // The verdict fields are the distinguishing contract: a reader must be able
    // to separate the rows by `meta.estimated` alone.
    expect(truthEntry.meta.estimated).not.toBe(estimateEntry.meta.estimated);
  });
});

// --- (d) the streaming fallback carries the same flag ------------------------

describe("DF-9ROUTER-39 (d) — the streaming estimate fallback is flagged identically", () => {
  it("flags a silent stream's estimated row in tokens AND meta (stream.js unchanged)", async () => {
    const { status } = await streamingViaWire({ upstream: ndjsonResponse(OLLAMA_STREAM_SILENT) });

    expect(status).toBe(200);
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);

    const entry = recordedUsage();
    expect(entry.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(entry.tokens.completion_tokens).toBeGreaterThan(0);
    expect(entry.tokens.estimated).toBe(true);
    expect(entry.meta.estimated).toBe(true);
  });
});

// --- (e) Gemini usageMetadata is recorded as upstream truth (DF-9ROUTER-39-R2) --
//
// Dogfood 2026-10-23 (docs/dogfood/2026-10-23-combos-and-usage-accounting.md)
// measured a Gemini non-stream request SERVED with usage.prompt_tokens = 2002
// while the usageHistory row recorded 2, and read the pair as the extraction
// missing `usageMetadata`. The real split, reproduced here on the wire path:
// extraction reads `usageMetadata` before translation (requestDetail.js
// extractUsageFromResponse) and the ledger already holds the upstream count —
// the SERVED number is the upstream count plus the 2000-token context-safety
// buffer (addBufferToUsage, usageTracking.js), which is applied to the client
// response only. These tests pin the ledger side: a Gemini-shaped upstream body
// (`usageMetadata`, no `usage`) records promptTokenCount verbatim, flagged as
// upstream truth — never the client-body estimate.

describe("DF-9ROUTER-39-R2 (e) — a Gemini usageMetadata response records the upstream prompt count", () => {
  it("records usageMetadata.promptTokenCount verbatim, not an estimate of the client body", async () => {
    const { status, text } = await nonStreamingViaWire({
      upstream: jsonResponse(geminiCompletionBody({ promptTokenCount: 2002 })),
      responseFormat: FORMATS.GEMINI,
    });

    expect(status).toBe(200);
    const served = JSON.parse(text);
    expect(served?.choices?.[0]?.message?.content).toBe("OK"); // the call really succeeded

    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    const entry = recordedUsage();
    expect(entry.tokens.prompt_tokens).toBe(2002);  // the upstream's count, not the ~25-token body estimate
    expect(entry.tokens.completion_tokens).toBe(1);
    expect(entry.tokens.estimated).toBeFalsy();     // upstream truth, not a local estimate
    expect(entry.meta.estimated).toBe(false);
    // The served usage may carry the context-safety buffer on top of the
    // upstream count (addBufferToUsage); the ledger must never inherit it.
    expect(served?.usage?.prompt_tokens).toBeGreaterThanOrEqual(2002);
    expect(entry.tokens.prompt_tokens).toBeLessThanOrEqual(served.usage.prompt_tokens);
  });

  it("keeps the completion count and cached subset from the same metadata", async () => {
    await nonStreamingViaWire({
      upstream: jsonResponse(geminiCompletionBody({ promptTokenCount: 1234, candidatesTokenCount: 56, cachedContentTokenCount: 78 })),
      responseFormat: FORMATS.GEMINI,
    });

    const entry = recordedUsage();
    expect(entry.tokens.prompt_tokens).toBe(1234);
    expect(entry.tokens.completion_tokens).toBe(56);
    expect(entry.tokens.cached_tokens).toBe(78);
    expect(entry.meta.estimated).toBe(false);
  });

  it("tracks the upstream count across magnitudes (a 3-token and a 40k-token prompt)", async () => {
    await nonStreamingViaWire({
      upstream: jsonResponse(geminiCompletionBody({ promptTokenCount: 3 })),
      responseFormat: FORMATS.GEMINI,
    });
    expect(recordedUsage().tokens.prompt_tokens).toBe(3);

    vi.clearAllMocks();

    await nonStreamingViaWire({
      upstream: jsonResponse(geminiCompletionBody({ promptTokenCount: 40000 })),
      responseFormat: FORMATS.GEMINI,
    });
    expect(recordedUsage().tokens.prompt_tokens).toBe(40000);
  });
});
