import { describe, it, expect, vi } from "vitest";
import "../translator/registerAll.js";

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
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const upstream400 = (error) => ({
  response: new Response(JSON.stringify({ error }), { status: 400, headers: { "content-type": "application/json" } }),
  url: "https://api.githubcopilot.com/responses",
  headers: {},
  transformedBody: null,
});

const run = () => handleChatCore({
  body: { model: "gpt-5", stream: true, input: "hi" },
  modelInfo: { provider: "github", model: "gpt-5" },
  credentials: { apiKey: "test", providerSpecificData: {} },
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  connectionId: "test-conn",
  sourceFormatOverride: "openai-responses",
  clientRawRequest: { endpoint: "/v1/responses", body: {}, headers: {} },
});

describe("chatCore keeps context overflow distinguishable (#5278)", () => {
  it("maps the GitHub Copilot overflow body to context_length_exceeded", async () => {
    executeMock.mockResolvedValueOnce(upstream400({
      message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
      code: "invalid_request_body",
    }));
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    const body = await result.response.json();
    expect(body.error.code).toBe("context_length_exceeded");
    expect(body.error.message).toContain("exceeds the context window");
  });

  it("leaves an unrelated invalid_request_body as bad_request", async () => {
    executeMock.mockResolvedValueOnce(upstream400({ message: "Unsupported parameter: foo", code: "invalid_request_body" }));
    const result = await run();
    expect((await result.response.json()).error.code).toBe("bad_request");
  });
});
