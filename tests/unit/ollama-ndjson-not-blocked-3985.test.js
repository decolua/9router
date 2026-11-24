import { describe, expect, it, vi } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";

// Issue #3985: an ollama-local provider dials Ollama's native /api/chat, which answers
// application/x-ndjson on a SUCCESSFUL stream. The HTML-error-page guard in the streaming handler
// checked the content type alone and rejected it, so every Ollama request came back as
// "BLOCKED 200 ... non-SSE (application/x-ndjson)" even though
// translator/response/ollama-to-openai.js exists to convert that very stream.
//
// The guard still has to reject what it was written for: a Cloudflare-style HTML error page piped
// into the SSE transform crashes the chat router.

vi.mock("../../open-sse/utils/requestDetail.js", () => ({
  saveRequestDetail: vi.fn(async () => {}),
  buildRequestDetail: vi.fn(() => ({})),
  extractRequestConfig: vi.fn(() => ({})),
}));

const { handleStreamingResponse } = await import(
  "../../open-sse/handlers/chatCore/streamingHandler.js"
);

const OLLAMA_LINE = JSON.stringify({
  model: "qwen3:30b",
  message: { role: "assistant", content: "hi" },
  done: false,
}) + "\n";

function upstream(contentType, body) {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

// The pipe wraps this and clears its stall timer through it, so every method it touches has to exist.
function streamController() {
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => true,
    handleComplete: () => {},
    handleError: () => {},
    handleDisconnect: () => {},
    abort: () => {},
  };
}

function call(providerResponse, targetFormat) {
  return handleStreamingResponse({
    providerResponse,
    provider: "ollama-local",
    model: "qwen3:30b",
    sourceFormat: FORMATS.OPENAI,
    targetFormat,
    userAgent: "vitest",
    body: { model: "qwen3:30b", stream: true },
    stream: true,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    streamController: streamController(),
  });
}

describe("streaming handler content-type guard (#3985)", () => {
  it("does not block an Ollama-format upstream streaming application/x-ndjson", async () => {
    const result = await call(upstream("application/x-ndjson", OLLAMA_LINE), FORMATS.OLLAMA);

    expect(result.success).toBe(true);
    // The client is served SSE, translated from the NDJSON the provider sent.
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("still blocks an HTML error page, which is what the guard exists for", async () => {
    const html = "<html><head><title>502 Bad Gateway</title></head><body>nope</body></html>";
    const result = await call(upstream("text/html", html), FORMATS.OLLAMA);

    expect(result.success).toBe(false);
    expect(await result.response.json()).toEqual({
      error: { message: "[200]: 502 Bad Gateway" },
    });
  });

  it("still blocks x-ndjson from a provider whose format is not Ollama", async () => {
    // For an OpenAI-format upstream, NDJSON is not a stream this router can translate, so the
    // guard's refusal is the right answer and must not be widened away.
    const result = await call(upstream("application/x-ndjson", OLLAMA_LINE), FORMATS.OPENAI);

    expect(result.success).toBe(false);
  });

  it("keeps passing the two content types every provider may stream", async () => {
    for (const contentType of ["text/event-stream", "application/json"]) {
      const result = await call(upstream(contentType, "data: {}\n\n"), FORMATS.OPENAI);
      expect(result.success, contentType).toBe(true);
    }
  });
});
