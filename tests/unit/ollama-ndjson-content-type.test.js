import { describe, expect, it } from "vitest";

import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// The non-SSE guard exists to catch HTML error pages (e.g. a Cloudflare 5xx)
// before they reach the SSE transform. Ollama streams application/x-ndjson,
// which the transform DOES understand, so the guard must let it through —
// otherwise every local Ollama request dies as "Provider error" with no status.
function ndjsonResponse(contentType) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          JSON.stringify({
            model: "qwen3:0.6b",
            message: { role: "assistant", content: "LOCAL_OK" },
            done: true,
            done_reason: "stop",
          }) + "\n",
        ),
      );
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function callGuard(contentType) {
  return handleStreamingResponse({
    providerResponse: ndjsonResponse(contentType),
    provider: "ollama-local",
    model: "qwen3:0.6b",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OLLAMA,
    body: {},
    stream: true,
    requestStartTime: Date.now(),
    streamController: {
      signal: new AbortController().signal,
      startTime: Date.now(),
      isConnected: () => true,
      handleError: () => {},
    },
  });
}

describe("streaming guard content-type handling", () => {
  it("passes Ollama NDJSON through instead of blocking it", async () => {
    const result = await callGuard("application/x-ndjson");
    expect(result.success).toBe(true);
  });

  it("still blocks HTML error pages", async () => {
    const result = await callGuard("text/html");
    expect(result.success).toBe(false);
  });
});
