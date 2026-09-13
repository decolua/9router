// Copilot review #3 regression: when the provider forces streaming and the client wants
// JSON, the web-search intercept must run on the converted body too (sseToJsonHandler.js),
// not only on the plain non-streaming path. The search executor is mocked as in
// webSearchIntercept.test.js; what is verified is that handleForcedSSEToJson routes the
// response through applyWebSearchFallback.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleSearchCore: vi.fn(),
  getSettings: vi.fn(),
  getCombos: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: mocks.updateProviderCredentials,
  checkAndRefreshToken: mocks.checkAndRefreshToken,
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getCombos: mocks.getCombos,
}));
vi.mock("@/shared/constants/providers.js", () => ({
  AI_PROVIDERS: { tavily: { searchConfig: { endpoint: "https://x" } } },
  resolveProviderId: (p) => String(p).split("/").pop(),
}));
vi.mock("open-sse/handlers/search/index.js", () => ({
  handleSearchCore: mocks.handleSearchCore,
}));
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const PLAN = { enabled: true, toolName: "9router_web_search", convertedToolCount: 1 };
const SEARCH_DATA = {
  provider: "tavily",
  query: "latest ai news",
  results: [{ title: "A", url: "https://a", snippet: "s" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ webSearchFallbackProvider: "tavily" });
  mocks.getCombos.mockResolvedValue([]);
  mocks.getProviderCredentials.mockResolvedValue({ connectionId: "c1", accessToken: "t" });
  mocks.checkAndRefreshToken.mockResolvedValue({ accessToken: "t" });
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
  mocks.handleSearchCore.mockResolvedValue({ success: true, data: SEARCH_DATA });
});

function sseResponse(raw) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(raw)); controller.close(); },
  }), { headers: { "content-type": "text/event-stream" } });
}

const baseCtx = (over) => ({
  provider: "op-test-chat",
  model: "gpt-x",
  body: { model: "gpt-x", messages: [] },
  stream: false,
  requestStartTime: Date.now(),
  connectionId: "test-connection",
  clientRawRequest: { endpoint: "/v1/chat/completions" },
  trackDone: vi.fn(),
  appendLog: vi.fn(),
  log: {},
  ...over,
});

// Chat Completions SSE where the model calls the converted fallback tool.
const CHAT_SEARCH_SSE = [
  'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"9router_web_search","arguments":"{\\"query\\":\\"latest ai news\\"}"}}]},"finish_reason":null}]}',
  'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  "data: [DONE]",
  "",
].join("\n\n");

describe("forced-SSE path runs the web-search intercept", () => {
  it("rewrites a chat-client response with tool_results (chat SSE source)", async () => {
    const result = await handleForcedSSEToJson(baseCtx({
      providerResponse: sseResponse(CHAT_SEARCH_SSE),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      webSearchFallbackPlan: PLAN,
    }));
    expect(result.success).toBe(true);
    expect(mocks.handleSearchCore).toHaveBeenCalledTimes(1);
    expect(mocks.handleSearchCore.mock.calls[0][0].body.query).toBe("latest ai news");
    const json = await result.response.json();
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("9router_web_search");
    expect(json.tool_results).toHaveLength(1);
    expect(json.tool_results[0].tool_call_id).toBe("call_9");
    expect(JSON.parse(json.tool_results[0].output).results).toHaveLength(1);
  });

  it("appends function_call_output for a Responses client (chat SSE source)", async () => {
    const result = await handleForcedSSEToJson(baseCtx({
      providerResponse: sseResponse(CHAT_SEARCH_SSE),
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      webSearchFallbackPlan: PLAN,
    }));
    const json = await result.response.json();
    expect(json.object).toBe("response");
    expect(json.output.map((o) => o.type)).toContain("function_call_output");
    expect(json.output.map((o) => o.type)).toContain("web_search_call");
  });

  it("rewrites a Responses-API SSE source before returning it to a Responses client", async () => {
    const events = [
      "event: response.output_item.done",
      'data: {"output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"fc_1","name":"9router_web_search","arguments":"{\\"query\\":\\"latest ai news\\"}"}}',
      "",
      "event: response.completed",
      'data: {"response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
      "",
      "",
    ].join("\n");
    const result = await handleForcedSSEToJson(baseCtx({
      providerResponse: sseResponse(events),
      provider: "codex",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      webSearchFallbackPlan: PLAN,
    }));
    const json = await result.response.json();
    expect(mocks.handleSearchCore).toHaveBeenCalledTimes(1);
    const outputTypes = json.output.map((o) => o.type);
    expect(outputTypes).toContain("function_call_output");
    expect(outputTypes).toContain("web_search_call");
  });

  it("leaves the response untouched when no fallback plan is present", async () => {
    const result = await handleForcedSSEToJson(baseCtx({
      providerResponse: sseResponse(CHAT_SEARCH_SSE),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
    }));
    expect(mocks.handleSearchCore).not.toHaveBeenCalled();
    const json = await result.response.json();
    expect(json).not.toHaveProperty("tool_results");
  });
});
