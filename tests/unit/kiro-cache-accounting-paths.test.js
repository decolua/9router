import { beforeEach, describe, expect, it, vi } from "vitest";

const usageDb = vi.hoisted(() => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("@/lib/usageDb.js", () => usageDb);

const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const CACHED_SYSTEM = "The quick brown fox jumps over the lazy dog again. ".repeat(200);
const USAGE = { prompt_tokens: 20000, completion_tokens: 100, total_tokens: 20100 };

function makeBody() {
  return {
    model: "claude-sonnet-4",
    system: [{ type: "text", text: CACHED_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: "Please help me." }],
  };
}

function makeCtx(connectionId) {
  return {
    provider: "kiro",
    model: "claude-sonnet-4",
    sourceFormat: "claude",
    body: makeBody(),
    stream: false,
    connectionId,
    apiKey: "test-key",
    requestStartTime: Date.now(),
    translatedBody: null,
    finalBody: null,
    clientRawRequest: { endpoint: "/v1/messages" },
    appendLog: vi.fn(),
    trackDone: vi.fn(),
    log: null,
    reqLogger: {
      logProviderResponse: vi.fn(),
      logConvertedResponse: vi.fn(),
    },
  };
}

function expectCachePersisted() {
  const detail = usageDb.saveRequestDetail.mock.calls.at(-1)[0];
  const persisted = usageDb.saveRequestUsage.mock.calls.at(-1)[0];

  expect(detail.tokens.cache_creation_input_tokens).toBeGreaterThan(0);
  // saveUsageStats uses canonicalizeUsage: prompt stays cache-inclusive, and
  // cache creation survives into the usage database record.
  expect(persisted.tokens.prompt_tokens).toBe(USAGE.prompt_tokens);
  expect(persisted.tokens.cache_creation_input_tokens).toBeGreaterThan(0);
}

describe("Kiro cache accounting persistence paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges cache usage before non-streaming request detail and usage DB", async () => {
    const ctx = makeCtx(`non-stream-${Date.now()}`);
    const response = new Response(JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: USAGE,
    }), { headers: { "content-type": "application/json" } });

    await handleNonStreamingResponse({ ...ctx, providerResponse: response, targetFormat: "openai", toolNameMap: null });

    expectCachePersisted();
  });

  it("merges cache usage before streaming request detail and usage DB", () => {
    const ctx = makeCtx(`stream-${Date.now()}`);
    const { onStreamComplete } = buildOnStreamComplete(ctx);

    onStreamComplete({ content: "ok" }, USAGE, Date.now());

    expectCachePersisted();
  });

  it("merges cache usage before forced SSE-to-JSON request detail and usage DB", async () => {
    const ctx = makeCtx(`sse-json-${Date.now()}`);
    const sse = [
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        created: 1,
        model: "claude-sonnet-4",
        choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: USAGE,
      })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const response = new Response(sse, { headers: { "content-type": "text/event-stream" } });

    await handleForcedSSEToJson({ ...ctx, providerResponse: response });

    expectCachePersisted();
  });
});
