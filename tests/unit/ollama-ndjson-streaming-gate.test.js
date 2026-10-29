// DF-9ROUTER-24 — the non-SSE gate in streamingHandler.js blocked Ollama's
// NDJSON stream.
//
// A native Ollama upstream (`ollama-local` → `POST /api/chat`) answers a
// `stream:true` request with `application/x-ndjson`: one raw JSON object per
// line, no `data:` prefix. streamingHandler's content-type gate rejected every
// response that was neither `text/event-stream` nor `application/json` — a
// guard that exists so an upstream HTML/plain-text error page cannot be piped
// into the SSE transform (Next.js "failed to pipe response" crash). NDJSON was
// caught by that guard even though the transform downstream already parses it:
// stream.js's parseSSELine + the FORMATS.OLLAMA branch of translateResponse
// pivot Ollama chunks into the client's format.
//
// Live symptom (dogfood 2026-09-16): server stdout `BLOCKED 200 · non-SSE
// (application/x-ndjson)` and the client got a 503 — every streaming request
// to the only credential-free provider path failed, while Ollama itself
// answered 200. Claude Code / Cline / Cursor / Codex stream by default.
//
// These tests drive the real wire path (handleChatCore → streamingHandler →
// buildTransformStream → stream.js); the executor is the only stub.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterAll, vi } from "vitest";

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

// Temp DATA_DIR so the handlers under test resolve their state into a sandbox.
const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-ollama-ndjson-"));
process.env.DATA_DIR = tempDir;
vi.resetModules();

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const PROVIDER = "ollama-local";
const MODEL = "gemma3:4b";

// --- upstream wire shapes ----------------------------------------------------

// Ollama /api/chat streaming: NDJSON, one object per line, `done:true` carries
// finish_reason + token counts. Trailing newline included (the no-newline tail
// is covered by ollama-stream-tail.test.js).
const ndjsonChunk = (content, done = false) => JSON.stringify({
  model: MODEL,
  created_at: "2026-09-16T00:00:00Z",
  message: { role: "assistant", content },
  done,
  ...(done ? { done_reason: "stop", prompt_eval_count: 11, eval_count: 7 } : {}),
});

const OLLAMA_NDJSON = [
  ndjsonChunk("DOGFOOD_"),
  ndjsonChunk("OK"),
  ndjsonChunk("", true),
].join("\n") + "\n";

const HTML_ERROR = "<html><head><title>502 Bad Gateway</title></head></html>";

function streamResponse(text, contentType, status = 200) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status, headers: { "content-type": contentType } });
}

// --- drivers -----------------------------------------------------------------

async function streamViaWire({ body, upstream, endpoint = "/v1/chat/completions", headers = { "content-type": "application/json" }, sourceFormatOverride = null }) {
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
    clientRawRequest: { endpoint, headers, body },
    stream: true,
    ...(sourceFormatOverride ? { sourceFormatOverride } : {}),
  });
  return { status: result.response.status, headers: result.response.headers, text: await result.response.text() };
}

// Gate level: call handleStreamingResponse directly so the upstream status can
// be a real error status (chatCore intercepts non-2xx before the gate).
async function gateOnly(upstream) {
  const streamController = { handleError: vi.fn(), handleComplete: vi.fn() };
  return handleStreamingResponse({
    providerResponse: upstream,
    provider: PROVIDER,
    model: MODEL,
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OLLAMA,
    userAgent: "probe/1.0",
    body: { model: MODEL, messages: [], stream: true },
    stream: true,
    translatedBody: null,
    finalBody: { model: MODEL, messages: [], stream: true },
    requestStartTime: Date.now(),
    connectionId: null,
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body: {} },
    reqLogger: null,
    toolNameMap: null,
    customToolNames: null,
    streamController,
    onStreamComplete: null,
    streamDetailId: null,
    pxpipe: null,
    reqTag: "probe",
    log: null,
    credentials: {},
  });
}

// --- readers -----------------------------------------------------------------

const dataLines = (body) => body
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("data:"));

const jsonEvents = (body) => dataLines(body)
  .map((l) => l.slice(5).trim())
  .filter((p) => p && p !== "[DONE]")
  .map((p) => { try { return JSON.parse(p); } catch { return null; } })
  .filter(Boolean);

const openaiText = (body) => jsonEvents(body)
  .map((e) => e.choices?.[0]?.delta?.content || "")
  .join("");

const claudeText = (body) => jsonEvents(body)
  .filter((e) => e.type === "content_block_delta" && e.delta?.type === "text_delta")
  .map((e) => e.delta.text)
  .join("");

// The gate's blocked shape is a single JSON object with an `error` key.
const looksBlocked = (t) => t.trim().startsWith("{") && t.includes('"error"');

const openaiBody = () => ({
  model: `${PROVIDER}/${MODEL}`,
  messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }],
  stream: true,
});

const anthropicBody = () => ({
  model: `${PROVIDER}/${MODEL}`,
  max_tokens: 64,
  messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }],
  stream: true,
});

describe("DF-9ROUTER-24 — NDJSON (Ollama) upstreams stream through the gate", () => {
  // (1) The defect: an OpenAI client on an ollama-local upstream.
  it("(1) passes application/x-ndjson and emits OpenAI SSE (no BLOCKED error)", async () => {
    const { status, text } = await streamViaWire({
      body: openaiBody(),
      upstream: streamResponse(OLLAMA_NDJSON, "application/x-ndjson"),
    });

    // Pre-fix this was the gate's JSON error body: {"error":{"message":"[200]: …"}}.
    expect(looksBlocked(text)).toBe(false);
    expect(text).not.toContain("non-SSE");

    expect(status).toBe(200);
    expect(dataLines(text).length).toBeGreaterThan(0);
    expect(openaiText(text)).toBe("DOGFOOD_OK");

    const events = jsonEvents(text);
    expect(events[0].choices[0].delta.content).toBe("DOGFOOD_");
    expect(events.every((e) => e.object === "chat.completion.chunk")).toBe(true);
    expect(events.at(-1).choices[0].finish_reason).toBe("stop");
    expect(events.at(-1).usage).toEqual({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
    expect(text).toContain("data: [DONE]");
  });

  // (2) A Claude client on the same upstream must get Anthropic framing.
  it("(2) passes the same NDJSON to a Claude client as Anthropic SSE", async () => {
    const { status, text } = await streamViaWire({
      body: anthropicBody(),
      upstream: streamResponse(OLLAMA_NDJSON, "application/x-ndjson"),
      endpoint: "/v1/messages",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      sourceFormatOverride: FORMATS.CLAUDE,
    });

    expect(status).toBe(200);
    expect(text).not.toContain("BLOCKED");

    const events = jsonEvents(text);
    expect(events.some((e) => e.type === "message_start")).toBe(true);
    expect(claudeText(text)).toBe("DOGFOOD_OK");
    expect(events.some((e) => e.type === "message_stop")).toBe(true);

    // Not OpenAI-shaped: an Anthropic client must not receive choices frames.
    expect(text).not.toContain("chat.completion.chunk");
    expect(events.some((e) => e.choices)).toBe(false);
  });

  // (2b) Content-Type is case-insensitive and may carry parameters.
  it("(2b) accepts a charset-parameterised, mixed-case NDJSON content-type", async () => {
    const { text } = await streamViaWire({
      body: openaiBody(),
      upstream: streamResponse(OLLAMA_NDJSON, "Application/X-NDJSON; charset=utf-8"),
    });

    expect(text).not.toContain("BLOCKED");
    expect(openaiText(text)).toBe("DOGFOOD_OK");
  });

  // (3) The gate still does its original job: an HTML error body is blocked.
  it("(3) still blocks an HTML error page (wire path, status 200)", async () => {
    const { status, text } = await streamViaWire({
      body: openaiBody(),
      upstream: streamResponse(HTML_ERROR, "text/html"),
    });

    expect(status).toBe(200);
    const body = JSON.parse(text);
    expect(body.error.message).toContain("502 Bad Gateway");
    expect(dataLines(text)).toEqual([]);
    expect(text).not.toContain("data: [DONE]");
  });

  it("(3b) blocks an HTML error page and preserves a non-2xx upstream status", async () => {
    const upstream = streamResponse(HTML_ERROR, "text/html", 502);
    const result = await gateOnly(upstream);

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
    expect(result.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(result.response.headers.get("Content-Type")).toBe("application/json");

    const body = await result.response.text();
    expect(JSON.parse(body).error.message).toContain("502 Bad Gateway");
    expect(body).not.toContain("data: ");
  });

  it("(3c) blocks a plain-text body with no <title>", async () => {
    const result = await gateOnly(streamResponse("upstream exploded", "text/plain", 503));

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(503);
    const body = await result.response.text();
    expect(JSON.parse(body).error.message).toContain("upstream exploded");
  });
});
