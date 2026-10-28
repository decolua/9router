import { afterEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute }) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

afterEach(() => vi.clearAllMocks());

describe("OpenAI stream flag default", () => {
  it.each([undefined, false])("returns JSON when stream is %s", async (stream) => {
    execute.mockResolvedValue({
      response: Response.json({
        id: "chatcmpl-fixture", object: "chat.completion", model: "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }),
      url: "https://example.invalid/v1/chat/completions", headers: {}, transformedBody: {},
    });
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "hello" }], ...(stream === undefined ? {} : { stream }) };
    const result = await handleChatCore({
      body, modelInfo: { provider: "openai-compatible-fixture", model: "gpt-4o" }, credentials: {},
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, connectionId: "fixture",
      rtkEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: {}, body },
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ stream: false }));
    expect(result.response.headers.get("content-type")).toContain("application/json");
    expect((await result.response.json()).choices[0].message.content).toBe("ok");
  });

  it.each([false, true])("returns 502 for an empty native failure masked as HTTP 200 (forced SSE=%s)", async (forcedSSE) => {
    const choice = { index: 0, finish_reason: "stop", native_finish_reason: "network_error" };
    const response = forcedSSE
      ? new Response(`data: ${JSON.stringify({ choices: [{ ...choice, delta: {} }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
      : Response.json({ choices: [{ ...choice, message: { content: "" } }] });
    execute.mockResolvedValue({ response, url: "https://example.invalid", headers: {}, transformedBody: {} });
    const body = { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] };
    const result = await handleChatCore({
      body, modelInfo: { provider: forcedSSE ? "openai" : "openai-compatible-fixture", model: "gpt-4o" }, credentials: {},
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, connectionId: "fixture",
      rtkEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: {}, body },
    });
    expect(result.response.status).toBe(502);
    expect(await result.response.text()).toContain("network_error");
  });
});
