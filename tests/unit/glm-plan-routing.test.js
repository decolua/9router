import { describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));
vi.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/translator/concerns/image.js", () => ({
  encodeDataUri: (mimeType, base64) => `data:${mimeType};base64,${base64}`,
  parseDataUri: () => null,
  fetchImageAsBase64: async () => null,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("GLM ZCode plan routing", () => {
  it("translates an OpenAI client request instead of leaking the direct transport", async () => {
    executeMock.mockImplementationOnce(async ({ credentials }) => ({
      response: new Response(JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "glm-5.2",
        content: [{ type: "text", text: "ok" }], stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages",
      headers: {},
      transformedBody: null,
      credentials,
    }));

    const credentials = {
      accessToken: "plan-key",
      providerSpecificData: { plan: "start-plan", zcodeJwtToken: "zcode-jwt" },
    };
    const result = await handleChatCore({
      body: { model: "glm/glm-5.2", stream: false, messages: [{ role: "user", content: "hi" }] },
      modelInfo: { provider: "glm", model: "glm-5.2" },
      credentials,
      connectionId: "glm-route-test",
      sourceFormatOverride: "openai",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    expect(result.success).toBe(true);
    expect(executeMock.mock.calls[0][0].credentials.runtimeTransport).toBeUndefined();
    expect(executeMock.mock.calls[0][0].body).toHaveProperty("system");
  });
});