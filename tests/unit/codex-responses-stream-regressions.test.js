import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the persistence boundary is mocked; the streaming pipeline runs for real
// (ReadableStream -> Response -> handleStreamingResponse -> SSE transform).
const { saveRequestDetailMock, saveRequestUsageMock } = vi.hoisted(() => ({
  saveRequestDetailMock: vi.fn(async () => {}),
  saveRequestUsageMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: saveRequestDetailMock,
  saveRequestUsage: saveRequestUsageMock,
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const { buildOnStreamComplete, handleStreamingResponse } = await import(
  "../../open-sse/handlers/chatCore/streamingHandler.js"
);
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");

const encoder = new TextEncoder();

function openAISSE(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function drain(response) {
  const reader = response.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

// Mirrors the codex Responses-wire SSE routes: the provider emits Responses API
// events (targetFormat = "openai-responses") and sourceFormat is the client-
// facing format. When the client speaks the same format (Codex CLI,
// sourceFormat = targetFormat = "openai-responses"), buildTransformStream()
// selects the translate stream with source === target === OPENAI_RESPONSES;
// any other sourceFormat (e.g. "openai") takes the translated route instead.
const baseBody = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true };

// clientRawRequest.endpoint mirrors the client-facing route of the source format
const ENDPOINT_BY_SOURCE_FORMAT = {
  "openai-responses": "/v1/responses",
  openai: "/v1/chat/completions",
  claude: "/v1/messages",
};

async function runResponsesPassthrough(chunks, { sourceFormat = "openai-responses" } = {}) {
  const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });
  const bodyStream = openAISSE(chunks);
  const requestStartTime = Date.now();
  const endpoint = ENDPOINT_BY_SOURCE_FORMAT[sourceFormat] ?? "/v1/chat/completions";
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({
    provider: "openai",
    model: "gpt-4o",
    connectionId: "conn-1",
    apiKey: "sk-test",
    requestStartTime,
    body: baseBody,
    stream: true,
    clientRawRequest: { endpoint, body: baseBody },
  });

  const result = await handleStreamingResponse({
    providerResponse: new Response(bodyStream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    provider: "openai",
    model: "gpt-4o",
    sourceFormat,
    targetFormat: "openai-responses",
    body: baseBody,
    stream: true,
    requestStartTime,
    connectionId: "conn-1",
    apiKey: "sk-test",
    streamController,
    onStreamComplete,
    streamDetailId,
    clientRawRequest: { endpoint, body: baseBody },
  });

  await drain(result.response);
  return result;
}

const responseCompletedUsage = {
  input_tokens: 100,
  output_tokens: 20,
  total_tokens: 120,
  input_tokens_details: { cached_tokens: 40 },
};

describe("codex Responses streaming regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retains response.output_text.delta content in the persisted streaming response instead of [Empty streaming response]", async () => {
    // Real codex SSE shape: framed text deltas followed by a terminal
    // response.completed. Every text delta must land in the saved
    // RequestDetail's response.content — the accumulator must recognize the
    // Responses output_text delta shape so a fully-streamed codex turn is not
    // persisted as "[Empty streaming response]".
    const outputTextDelta = {
      type: "response.output_text.delta",
      delta: "Hello from codex",
    };
    const responseCompleted = {
      type: "response.completed",
      response: { usage: responseCompletedUsage },
    };

    await runResponsesPassthrough([
      `event: response.output_text.delta\ndata: ${JSON.stringify(outputTextDelta)}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify(responseCompleted)}\n\n`,
    ]);

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("success");
    // REGRESSION GUARD: saved content must be the streamed text,
    // not the "[Empty streaming response]" placeholder.
    expect(detail.response.content).toBe("Hello from codex");
    expect(detail.response.type).toBe("streaming");
  });

  it("persists canonical top-level cached_tokens on the streaming Request Detail when terminal usage nests the cache value", async () => {
    // response.completed carries input_tokens_details.cached_tokens (Responses
    // API convention). The persisted RequestDetail tokens must be canonicalized
    // to the storage convention (canonicalizeUsage(): prompt_tokens cache-
    // inclusive, top-level cached_tokens) matching the usageHistory row written
    // through saveUsageStats -> saveRequestUsage.
    const responseCompleted = {
      type: "response.completed",
      response: { usage: responseCompletedUsage },
    };

    await runResponsesPassthrough([
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hi" })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify(responseCompleted)}\n\n`,
    ], { sourceFormat: "openai" });

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("success");

    // The upstream is a Responses-API provider but the client speaks a different
    // format (here: OpenAI chat-completions, sourceFormat "openai"), so the
    // translated route's accumulator keeps provider-native usage fields. The
    // persisted RequestDetail tokens must still be canonicalized to the storage
    // convention (canonicalizeUsage(): prompt_tokens cache-inclusive, top-level
    // cached_tokens) — the same convention as the usageHistory row written
    // through saveUsageStats -> saveRequestUsage — so the two agree.
    const tokens = detail.tokens;

    // Cache-read tokens survive under the canonical top-level key.
    expect(tokens.cached_tokens).toBe(40);

    // Same convention as the usageHistory row: prompt_tokens cache-INCLUSIVE,
    // completion_tokens from the same output count.
    expect(tokens.prompt_tokens).toBe(100);
    expect(tokens.completion_tokens).toBe(20);

    // Cross-check: the usageHistory row written from the same usage object is
    // canonicalized via saveUsageStats -> canonicalizeUsage -> saveRequestUsage,
    // so it must carry the identical cached_tokens count.
    expect(saveRequestUsageMock).toHaveBeenCalledTimes(1);
    const [usageEntry] = saveRequestUsageMock.mock.calls[0];
    expect(usageEntry.tokens.cached_tokens).toBe(tokens.cached_tokens);
    expect(usageEntry.tokens.prompt_tokens).toBe(100);
    expect(usageEntry.tokens.completion_tokens).toBe(20);
  });
});
