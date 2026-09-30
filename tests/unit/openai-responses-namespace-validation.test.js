import { describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

describe("Codex namespace routing through chat core", () => {
  it("dispatches same-named children and restores the qualified tool name in JSON", async () => {
    executeMock.mockImplementation(async ({ body }) => ({
      response: new Response(JSON.stringify({
        id: "chatcmpl-js",
        object: "chat.completion",
        model: "deepseek-chat",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_js",
              type: "function",
              function: { name: body.tools[1].function.name, arguments: "{}" },
            }],
          },
          finish_reason: "tool_calls",
        }],
      }), { headers: { "content-type": "application/json" } }),
      url: "http://test-provider/chat/completions",
      headers: {},
      transformedBody: body,
    }));

    const result = await handleChatCore({
      body: {
        model: "deepseek/deepseek-chat",
        input: "Run JavaScript",
        stream: false,
        tools: [
          { type: "namespace", name: "mcp__cua_repl", tools: [{ type: "function", name: "js", parameters: { type: "object", properties: {} } }] },
          { type: "namespace", name: "mcp__node_repl", tools: [{ type: "function", name: "js", parameters: { type: "object", properties: {} } }] },
        ],
      },
      modelInfo: { provider: "deepseek", model: "deepseek-chat" },
      credentials: {},
      sourceFormatOverride: FORMATS.OPENAI_RESPONSES,
      clientRawRequest: { endpoint: "/v1/responses", headers: { accept: "application/json" } },
    });

    expect(executeMock).toHaveBeenCalledOnce();
    expect(executeMock.mock.calls[0][0].body.tools.map((tool) => tool.function.name)).toEqual([
      "mcp__cua_repl__js",
      "mcp__node_repl__js",
    ]);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.output.find((item) => item.type === "function_call").name).toBe("mcp__node_repl.js");
  });
});
