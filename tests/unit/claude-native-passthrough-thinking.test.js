import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, forcedSSEToJsonMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  forcedSSEToJsonMock: vi.fn(),
}));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: executeMock }) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => ({
  logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
  logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
}) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/sseToJsonHandler.js", () => ({ handleForcedSSEToJson: forcedSSEToJsonMock }));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

async function request(headers, providerThinking, extra = {}) {
  const model = "claude-sonnet-5-5";
  const body = { model, max_tokens: 1024, messages: [{ role: "user", content: "hello" }], stream: false, ...extra };
  await handleChatCore({
    body, modelInfo: { provider: "claude", model }, credentials: { accessToken: "test", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, connectionId: "test", providerThinking,
    sourceFormatOverride: "claude", clientRawRequest: { endpoint: "/v1/messages", body, headers },
  });
  return executeMock.mock.calls.at(-1)[0].body;
}

describe("Claude native passthrough thinking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ response: new Response('{"type":"message","content":[]}', { status: 200 }), url: "https://example.test", headers: {} });
    forcedSSEToJsonMock.mockResolvedValue({ success: true, response: new Response("{}", { status: 200 }) });
  });

  it.each([{ "user-agent": "claude-cli/2.1.323" }, { "x-app": "cli" }])("normalizes the configured effort for %j", async (headers) => {
    const body = await request(headers, { mode: "high" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.output_config?.effort).toBe("high");
  });

  it("keeps explicit Claude effort instead of overriding it", async () => {
    const body = await request({ "x-app": "cli" }, { mode: "high" }, { output_config: { effort: "low" } });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.output_config.effort).toBe("low");
  });

  it("preserves other output configuration while converting the provider setting", async () => {
    const body = await request({ "x-app": "cli" }, { mode: "high" }, { output_config: { format: { type: "json_schema", schema: { type: "object" } } } });
    expect(body.output_config).toEqual({ effort: "high", format: { type: "json_schema", schema: { type: "object" } } });
  });

  it("keeps an explicit thinking setting and leaves requests without an override unchanged", async () => {
    const explicit = await request({ "x-app": "cli" }, { mode: "high" }, { thinking: { type: "disabled" } });
    expect(explicit.thinking).toEqual({ type: "disabled" });
    expect(explicit.reasoning_effort).toBeUndefined();
    const plain = await request({ "x-app": "cli" }, null);
    expect(plain.reasoning_effort).toBeUndefined();
    expect(plain.output_config).toBeUndefined();
  });
});
