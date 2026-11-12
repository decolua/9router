// DF-9ROUTER-55-R2 — a chained OpenAI-compatible node hop must not change the
// client's stream intent.
//
// Dogfood 2026-10-20 (docs/dogfood/2026-10-20-live-chain-sse-integration.md,
// Finding 1): on v0.5.104, three identical chat completions through a
// compat-node hop (fresh instance → central) produced three different wire
// shapes — only one of them correct:
//
//   | request                 | content-type       | tail                          |
//   | stream key ABSENT       | text/event-stream  | JSON body + `data: [DONE]` glued, no newline → jq dies |
//   | stream:false (explicit) | application/json   | clean `}}`                    |
//   | stream:true             | text/event-stream  | `data: [DONE]` TWICE          |
//
// Central, on the same body, is clean — so the corruption is added by the edge
// hop itself. Root cause (same tree shape as DF-9ROUTER-32, whose fix lives on
// the federation branch): chatCore reads `let stream = ... (body.stream !==
// false)`, so an OMITTED stream key makes the router take the streaming path
// end to end while the outbound body carries no `stream` key — the OpenAI-
// compatible upstream answers `application/json` (the documented OpenAI
// default for an absent `stream`), and that raw JSON body is pushed through the
// streaming passthrough transform, which only understands `data:`-framed lines
// and appends the synthetic `data: [DONE]` "hang workaround" on flush (open-sse/
// utils/stream.js). For an explicit stream:true the upstream's own terminator
// is forwarded verbatim by the passthrough transform and flush() appends a
// SECOND one, because nothing latches streamDoneSent on the upstream's copy.
//
// The contract pinned here (wire level, through the real handler + real
// TransformStreams, with only the HTTP fetch stubbed by a deterministic local
// OpenAI-compatible upstream fixture):
//   1. stream ABSENT → application/json, bytes end in `}`, JSON.parse works,
//      no SSE terminator anywhere.
//   2. stream:false → identical non-stream JSON behavior.
//   3. stream:true → text/event-stream with EXACTLY ONE `data: [DONE]`.
//
// ch:trace row=DF-9ROUTER-55-R2 spec=open-sse/executors/default.js wave=9router-foreman-2026-10-20-19-33-59#DF-9ROUTER-55-R2 test=tests/unit/compat-node-stream-intent.test.js::chained OpenAI-compatible hop preserves the client's stream intent doc=docs/dogfood/2026-10-20-live-chain-sse-integration.md prompt=/tmp/DF-9ROUTER-55-R2-brief.txt evidence=tests/unit/compat-node-stream-intent.test.js witness=none:deterministic-local-fixture verdict=none:foreman-runs-after-commit memory=none:board-record
import { describe, expect, it, beforeEach, vi } from "vitest";

// The only network seam is the executor's fetch (base.js uses proxyAwareFetch,
// which falls through to global fetch when no proxy is configured). A local
// http.createServer fixture would bind a port for no additional fidelity: the
// bytes below are exactly what the wire carries either way, and this keeps the
// test hermetic (no sockets, no ports, no live services).
const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

// --- the compat-node fixture -------------------------------------------------
// A deterministic local OpenAI-compatible upstream (the "central" behind the
// node). Provider id `openai-compatible-chat-<uuid>` is the FULL node id shape
// the connections API snapshots into a connection; credentials carry the
// baseUrl + apiType exactly as POST /api/providers stores them (Finding 2 of
// the same dogfood run).
const NODE_PROVIDER = "openai-compatible-chat-df55r2-node";
const NODE_BASE_URL = "http://127.0.0.1:1/v1"; // never contacted — fetch is stubbed
const MODEL = "qwen3.8-27b";
const UPSTREAM_URL = `${NODE_BASE_URL}/chat/completions`;

const SENTINEL = "data: [DONE]";

const chunkBase = { id: "chatcmpl-node", object: "chat.completion.chunk", created: 1, model: MODEL };
const chunk = (delta, finishReason = null) => ({ ...chunkBase, choices: [{ index: 0, delta, finish_reason: finishReason }] });
const line = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

// What an OpenAI-compatible upstream answers when the request body carries no
// `stream` key (the documented OpenAI default) or explicit stream:false:
// one JSON body.
const UPSTREAM_JSON = JSON.stringify({
  id: "chatcmpl-node-json",
  object: "chat.completion",
  created: 1,
  model: MODEL,
  choices: [{ index: 0, message: { role: "assistant", content: "NODE_HOP_OK" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 2592, completion_tokens: 105, total_tokens: 2697 },
  system_fingerprint: "qwen3.8-27b",
});

// What the same upstream answers to an explicit stream:true: an event stream
// terminated by its own single sentinel.
const UPSTREAM_SSE = [
  line(chunk({ role: "assistant", content: "NODE_HOP_" })),
  line(chunk({ content: "OK" })),
  line({ ...chunk({}, "stop"), usage: { prompt_tokens: 2592, completion_tokens: 105, total_tokens: 2697 } }),
  `${SENTINEL}\n\n`,
].join("");

function upstreamResponse(text, contentType) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  }), { status: 200, headers: { "content-type": contentType } });
}

// --- driver: the real chained seam -------------------------------------------
// handleChatCore → real DefaultExecutor (openai-compatible-chat-* branch of
// buildUrl) → stubbed HTTP → real nonStreamingHandler / streamingHandler →
// real passthrough SSE TransformStream. Nothing between the client and the
// upstream fixture is mocked except the socket itself.

let captured = null;

beforeEach(() => {
  fetchMock.mockReset();
  captured = null;
  fetchMock.mockImplementation(async (url, init) => {
    captured = { url: String(url), init };
    const isStreamRequest = (() => {
      try { return JSON.parse(init.body)?.stream === true; } catch { return false; }
    })();
    // The fixture behaves like the OpenAI API: stream absent/false → JSON,
    // stream:true → SSE.
    return isStreamRequest
      ? upstreamResponse(UPSTREAM_SSE, "text/event-stream")
      : upstreamResponse(UPSTREAM_JSON, "application/json");
  });
});

async function chain(bodyStream) {
  const body = {
    model: `${NODE_PROVIDER}/${MODEL}`,
    messages: [{ role: "user", content: "Reply with exactly: NODE_HOP_OK" }],
  };
  if (bodyStream !== undefined) body.stream = bodyStream;

  const result = await handleChatCore({
    body,
    modelInfo: { provider: NODE_PROVIDER, model: MODEL },
    credentials: {
      apiKey: "node-key",
      providerSpecificData: { baseUrl: NODE_BASE_URL, apiType: "chat" },
    },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      body,
    },
  });
  expect(result.success, `request failed: ${result.error || "unknown"}`).toBe(true);
  return result.response;
}

describe("chained OpenAI-compatible hop preserves the client's stream intent", () => {
  it("stream ABSENT → application/json, JSON parses, bytes end in `}`, no [DONE]", async () => {
    const response = await chain(undefined);

    expect(response.headers.get("content-type")).toContain("application/json");

    const text = await response.text();
    expect(() => JSON.parse(text)).not.toThrow();

    const parsed = JSON.parse(text);
    expect(parsed.object).toBe("chat.completion");
    expect(parsed.choices[0].message.content).toBe("NODE_HOP_OK");

    // No SSE framing leaked into the JSON body (the glued-tail symptom).
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain("data:");
    expect(text.trimEnd().endsWith("}")).toBe(true);

    // The hop's upstream response was non-streaming; the router's own
    // decision is asserted by the JSON response shape above.
    expect(captured.url).toBe(UPSTREAM_URL);
  });

  it("stream:false → same non-stream JSON behavior", async () => {
    const response = await chain(false);

    expect(response.headers.get("content-type")).toContain("application/json");

    const text = await response.text();
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text);
    expect(parsed.choices[0].message.content).toBe("NODE_HOP_OK");

    expect(text).not.toContain("[DONE]");
    expect(text.trimEnd().endsWith("}")).toBe(true);

    expect(JSON.parse(captured.init.body).stream).toBe(false);
  });

  it("stream:true → text/event-stream with exactly ONE data: [DONE] sentinel", async () => {
    const response = await chain(true);

    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();

    // Deltas arrive as SSE and concatenate to the model's answer.
    const content = text
      .split("\n")
      .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
      .map((l) => { try { return JSON.parse(l.slice(6))?.choices?.[0]?.delta?.content || ""; } catch { return ""; } })
      .join("");
    expect(content).toBe("NODE_HOP_OK");

    // Exactly one terminator, after the content.
    const sentinelCount = text.split(SENTINEL).length - 1;
    expect(sentinelCount).toBe(1);
    expect(text.trimEnd().endsWith(SENTINEL)).toBe(true);
    expect(text.indexOf("NODE_HOP_")).toBeLessThan(text.indexOf(SENTINEL));

    expect(JSON.parse(captured.init.body).stream).toBe(true);
  });
});
