// DF-9ROUTER-30 — an executor pointed at an upstream of the WRONG protocol
// family surfaced as a silent empty success.
//
// Dogfood 2026-09-19 (HEAD 585bd31c): an `ollama-local` executor POSTs
// Ollama-native `/api/chat` and parses NDJSON (one bare JSON object per line, no
// `data:` prefix). Pointed at an OpenAI-shaped server, that server answered 200
// with `data: {...choices…}` lines the NDJSON parser returns null for: the SSE
// transform emitted nothing, and the client received HTTP 200 carrying only
// `data: [DONE]` with zero tokens while the central log printed a
// normal-looking `DONE 500ms · TTFT 499ms · IN 0 · OUT 0`. Nothing distinguished
// "the model produced nothing" from "the protocols disagree".
//
// The contract pinned here:
//   * a recognized FOREIGN protocol shape answered to an executor that spoke
//     native NDJSON (or the reverse) is a 502 `protocol_mismatch` naming the
//     executor, the upstream, the observed shape and the upstream's own first
//     line — the client never receives the hollow 200 + `data: [DONE]`;
//   * a legitimately EMPTY but protocol-valid completion is untouched (still a
//     200 with a real terminal chunk) — both directions are proven below;
//   * an unparseable/absent first line is NOT a mismatch: the guard fails open
//     and streams exactly as before;
//   * the peek is lossless: every byte of a healthy upstream still reaches the
//     client in order.
//
// The upstream is a deterministic in-test http server on 127.0.0.1 (never the
// network); the real executor is used so the request path and the request body
// are exercised for real — only the "cloud" is local.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

// Temp DATA_DIR so handlers resolve any state into a sandbox.
const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-protocol-mismatch-"));
process.env.DATA_DIR = tempDir;
vi.resetModules();

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const {
  classifyProtocolMismatch,
  classifyPayload,
  classifyBody,
  expectedFamilyFor,
  PROTOCOL_FAMILY,
  PROTOCOL_SHAPE,
} = await import("../../open-sse/handlers/chatCore/protocolMismatch.js");

const MODEL = "gemma3:4b";
const PROVIDER = "ollama-local";

// --- deterministic local "cloud" ---------------------------------------------
//
// One server, one switchable handler. It records what the executor actually sent
// so the test can prove the mismatch case really speaks the other protocol
// (rather than assuming it).

let server;
let port;
let handler = null;
let lastRequest = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      lastRequest = {
        method: req.method,
        url: req.url,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      handler(req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(() => {
  lastRequest = null;
});

afterEach(() => {
  handler = null;
});

const upstreamUrl = () => `http://127.0.0.1:${port}`;

// --- upstream wire shapes ----------------------------------------------------

// OpenAI-shaped SSE, exactly what LM Studio / any OpenAI-compatible server
// answers: `data:` framing, `choices[].delta`, a finish chunk, `data: [DONE]`.
const openaiSse = [
  `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "local-model", choices: [{ index: 0, delta: { role: "assistant", content: "IGNORED" }, finish_reason: null }] })}`,
  `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "local-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 } })}`,
  "data: [DONE]",
  "",
].join("\n\n");

// OpenAI-shaped NON-streaming JSON body (what the same upstream answers to a
// `stream:false` request).
const openaiJson = JSON.stringify({
  id: "chatcmpl-2",
  object: "chat.completion",
  created: 1,
  model: "local-model",
  choices: [{ index: 0, message: { role: "assistant", content: "IGNORED" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
});

// A LEGITIMATELY EMPTY but protocol-valid Ollama completion: correct NDJSON
// shape, `done:true`, a finish reason, zero content — the case that must NOT be
// flagged.
const ollamaEmptyNdjson = [
  JSON.stringify({ model: MODEL, created_at: "2026-09-19T00:00:00Z", message: { role: "assistant", content: "" }, done: false }),
  JSON.stringify({ model: MODEL, created_at: "2026-09-19T00:00:00Z", message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 11, eval_count: 0 }),
  "",
].join("\n");

// A protocol-valid Ollama stream that really produced content — the lossless
// control for the peek.
const ollamaOkNdjson = [
  JSON.stringify({ model: MODEL, created_at: "2026-09-19T00:00:00Z", message: { role: "assistant", content: "DOGFOOD_" }, done: false }),
  JSON.stringify({ model: MODEL, created_at: "2026-09-19T00:00:00Z", message: { role: "assistant", content: "OK" }, done: false }),
  JSON.stringify({ model: MODEL, created_at: "2026-09-19T00:00:00Z", message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 11, eval_count: 2 }),
  "",
].join("\n");

const send = (res, status, contentType, body) => {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
};

// --- drivers -----------------------------------------------------------------
//
// The real wire path: handleChatCore resolves the provider, translates the
// request into the executor's format, calls the REAL OllamaLocalExecutor (which
// POSTs `${upstream}/api/chat`) and hands the upstream Response to the response
// handlers. Only the upstream host is swapped for the local fixture.

const openaiBody = (stream) => ({
  model: `${PROVIDER}/${MODEL}`,
  messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }],
  stream,
});

async function drive({ body = openaiBody(true), endpoint = "/v1/chat/completions" } = {}) {
  const result = await handleChatCore({
    body,
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: { providerSpecificData: { baseUrl: upstreamUrl() } },
    clientRawRequest: { endpoint, headers: { "content-type": "application/json" }, body },
    stream: body.stream !== false,
  });
  return { result, status: result.response.status, text: await result.response.text() };
}

const dataLines = (text) => text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("data:"));
const jsonEvents = (text) => dataLines(text)
  .map((l) => l.slice(5).trim())
  .filter((p) => p && p !== "[DONE]")
  .map((p) => { try { return JSON.parse(p); } catch { return null; } })
  .filter(Boolean);

// --- classification unit layer ----------------------------------------------

describe("DF-9ROUTER-30 — protocol classification", () => {
  it("maps the executor's upstream format to the family it speaks", () => {
    expect(expectedFamilyFor(FORMATS.OLLAMA)).toBe(PROTOCOL_FAMILY.OLLAMA_NDJSON);
    expect(expectedFamilyFor(FORMATS.OPENAI)).toBe(PROTOCOL_FAMILY.FRAMED);
    expect(expectedFamilyFor(FORMATS.CLAUDE)).toBe(PROTOCOL_FAMILY.FRAMED);
  });

  it("recognizes the foreign protocol on the first raw line, both directions", () => {
    // An ollama executor fed an OpenAI SSE stream / OpenAI JSON body.
    expect(classifyProtocolMismatch({ responseFormat: FORMATS.OLLAMA, payload: "data: {\"choices\":[]}" }))
      .toMatchObject({ mismatch: true, expected: PROTOCOL_FAMILY.OLLAMA_NDJSON, observed: PROTOCOL_SHAPE.SSE });
    expect(classifyProtocolMismatch({ responseFormat: FORMATS.OLLAMA, payload: openaiJson }))
      .toMatchObject({ mismatch: true, observed: PROTOCOL_SHAPE.OPENAI_JSON });

    // A framed executor fed bare NDJSON (an Ollama server behind an
    // openai-compatible node).
    expect(classifyProtocolMismatch({ responseFormat: FORMATS.OPENAI, payload: `{"model":"gemma3:4b","message":{"content":"hi"},"done":false}` }))
      .toMatchObject({ mismatch: true, expected: PROTOCOL_FAMILY.FRAMED, observed: PROTOCOL_SHAPE.OLLAMA_NDJSON });
  });

  it("does NOT flag agreeing protocols, including empty and unparseable payloads", () => {
    // Protocol-valid empty Ollama completion.
    expect(classifyProtocolMismatch({ responseFormat: FORMATS.OLLAMA, payload: JSON.stringify({ model: MODEL, message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }) }).mismatch).toBe(false);
    // Protocol-valid OpenAI SSE / JSON.
    expect(classifyProtocolMismatch({ responseFormat: FORMATS.OPENAI, payload: "data: {\"choices\":[{\"delta\":{}}]}" }).mismatch).toBe(false);
    expect(classifyProtocolMismatch({ responseFormat: FORMATS.OPENAI, payload: openaiJson }).mismatch).toBe(false);
    // Unrecognized / absent first line fails OPEN (no false positives).
    expect(classifyProtocolMismatch({ responseFormat: FORMATS.OLLAMA, payload: "{\"weird\":true}" }).mismatch).toBe(false);
    expect(classifyProtocolMismatch({ responseFormat: FORMATS.OLLAMA, payload: "" }).mismatch).toBe(false);
    expect(classifyProtocolMismatch({ responseFormat: FORMATS.OLLAMA, payload: null }).mismatch).toBe(false);
    expect(classifyProtocolMismatch({ responseFormat: FORMATS.OLLAMA, payload: "</html>" }).mismatch).toBe(false);
  });

  it("shares one classifier for raw text and for parsed bodies", () => {
    expect(classifyPayload(openaiSse)).toBe(PROTOCOL_SHAPE.SSE);
    expect(classifyPayload(ollamaOkNdjson)).toBe(PROTOCOL_SHAPE.OLLAMA_NDJSON);
    expect(classifyBody(JSON.parse(openaiJson))).toBe(PROTOCOL_SHAPE.OPENAI_JSON);
    expect(classifyBody({ model: MODEL, message: { content: "" }, done: true })).toBe(PROTOCOL_SHAPE.OLLAMA_NDJSON);
    // An OpenAI body must never be read as an Ollama chunk.
    expect(classifyBody({ object: "chat.completion", choices: [] })).toBe(PROTOCOL_SHAPE.OPENAI_JSON);
  });
});

// --- (a) the defect: mismatch fails loud --------------------------------------

describe("DF-9ROUTER-30 (a) — mismatch fails loud instead of a hollow 200", () => {
  it("streaming: 502 protocol_mismatch naming executor, upstream path and first line", async () => {
    handler = (req, res) => send(res, 200, "text/event-stream", openaiSse);

    const { status, text } = await drive({ body: openaiBody(true) });

    // The defect was HTTP 200 + `data: [DONE]` + zero tokens.
    expect(status).toBe(502);
    expect(text).not.toContain("data: [DONE]");
    expect(dataLines(text)).toEqual([]);

    const body = JSON.parse(text);
    expect(body.error.code).toBe("protocol_mismatch");
    expect(body.error.type).toBe("server_error");
    expect(body.error.message).toContain("protocol_mismatch");
    // Names the executor and what it speaks.
    expect(body.error.message).toContain(PROVIDER);
    expect(body.error.message).toContain(PROTOCOL_FAMILY.OLLAMA_NDJSON);
    // Names the upstream, its status and content-type.
    expect(body.error.message).toContain(`${upstreamUrl()}/api/chat`);
    expect(body.error.message).toContain("HTTP 200");
    expect(body.error.message).toContain("text/event-stream");
    // Quotes the upstream's own first response line.
    expect(body.error.message).toContain("chat.completion.chunk");
  });

  it("the executor really did POST the ollama-native path (the premise)", async () => {
    handler = (req, res) => send(res, 200, "text/event-stream", openaiSse);
    await drive({ body: openaiBody(true) });

    expect(lastRequest.method).toBe("POST");
    expect(lastRequest.url).toBe("/api/chat");
    // Ollama-native request shape, not OpenAI's.
    const sent = JSON.parse(lastRequest.body);
    expect(sent.stream).toBe(true);
    expect(sent.messages).toBeDefined();
    expect(sent.choices).toBeUndefined();
  });

  it("non-streaming: the same mismatch is a 502, not a 200 with empty content", async () => {
    handler = (req, res) => send(res, 200, "application/json", openaiJson);

    const { status, text } = await drive({ body: openaiBody(false) });

    expect(status).toBe(502);
    expect(JSON.parse(text).error.code).toBe("protocol_mismatch");
  });

  it("an ollama-shaped client (Claude /v1/messages) gets the same loud failure", async () => {
    handler = (req, res) => send(res, 200, "text/event-stream", openaiSse);

    const body = {
      model: `${PROVIDER}/${MODEL}`,
      max_tokens: 64,
      messages: [{ role: "user", content: "Reply with exactly: DOGFOOD_OK" }],
      stream: true,
    };
    const { status, text } = await drive({
      body,
      endpoint: "/v1/messages",
    });

    expect(status).toBe(502);
    // Never the Anthropic framing a Claude client would read as a clean stop.
    expect(text).not.toContain("message_stop");
    expect(JSON.parse(text).error.code).toBe("protocol_mismatch");
  });
});

// --- (b) the legitimate empty completion is NOT flagged ----------------------

describe("DF-9ROUTER-30 (b) — a protocol-valid empty completion is unchanged", () => {
  it("streaming: an empty-but-valid Ollama stream still answers 200 with a terminal chunk", async () => {
    handler = (req, res) => send(res, 200, "application/x-ndjson", ollamaEmptyNdjson);

    const { status, text } = await drive({ body: openaiBody(true) });

    expect(status).toBe(200);
    expect(text).not.toContain("protocol_mismatch");
    expect(text).toContain("data: [DONE]");

    const events = jsonEvents(text);
    expect(events.length).toBeGreaterThan(0);
    // The finish chunk is present and carries the upstream's own counts: an
    // empty completion is a real, terminated answer — not a mismatch.
    expect(events.at(-1).choices[0].finish_reason).toBe("stop");
    expect(events.at(-1).usage).toEqual({ prompt_tokens: 11, completion_tokens: 0, total_tokens: 11 });
  });

  it("streaming: a protocol-valid stream with content is delivered byte-for-byte (the peek is lossless)", async () => {
    handler = (req, res) => send(res, 200, "application/x-ndjson", ollamaOkNdjson);

    const { status, text } = await drive({ body: openaiBody(true) });

    expect(status).toBe(200);
    expect(jsonEvents(text).map((e) => e.choices?.[0]?.delta?.content || "").join("")).toBe("DOGFOOD_OK");
    expect(text).toContain("data: [DONE]");
  });

  it("an OpenAI-shaped executor against an OpenAI-shaped upstream is untouched", async () => {
    handler = (req, res) => send(res, 200, "text/event-stream", openaiSse);

    const body = {
      model: "openai-compatible-probe/probe-model",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const result = await handleChatCore({
      body,
      modelInfo: { provider: "openai-compatible-probe", model: "probe-model" },
      credentials: { apiKey: "k", providerSpecificData: { baseUrl: upstreamUrl(), apiType: "chat" } },
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "content-type": "application/json" }, body },
      stream: true,
    });
    const text = await result.response.text();

    expect(result.response.status).toBe(200);
    expect(text).not.toContain("protocol_mismatch");
    expect(jsonEvents(text).map((e) => e.choices?.[0]?.delta?.content || "").join("")).toBe("IGNORED");
    expect(lastRequest.url).toBe("/chat/completions");
  });
});
