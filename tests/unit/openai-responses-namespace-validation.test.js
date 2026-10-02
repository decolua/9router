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
const { CodexExecutor } = await import("../../open-sse/executors/codex.js");

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
    expect(json.output.find((item) => item.type === "function_call").name).toBe("mcp__node_repl__js");
  });

  it("preserves native Codex call names until the executor can allocate collision-safe aliases", async () => {
    executeMock.mockClear();
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({
        id: "resp_native",
        object: "response",
        status: "completed",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] }],
      }), { headers: { "content-type": "application/json" } }),
      url: "http://codex/responses",
      headers: {},
      transformedBody: null,
    });

    await handleChatCore({
      body: {
        model: "codex/gpt-6-luna",
        input: [
          { type: "custom_tool_call", call_id: "call_dot", name: "foo.bar", input: "run" },
          { type: "custom_tool_call_output", call_id: "call_dot", output: "ok" },
          { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
        ],
        stream: false,
        tools: [
          { type: "custom", name: "foo.bar", format: { type: "text" } },
          { type: "function", name: "foo_bar", parameters: { type: "object", properties: {} } },
        ],
      },
      modelInfo: { provider: "codex", model: "gpt-6-luna" },
      credentials: { providerSpecificData: {} },
      sourceFormatOverride: FORMATS.OPENAI_RESPONSES,
      clientRawRequest: { endpoint: "/v1/responses", headers: { "user-agent": "codex-cli/0.155.0", accept: "application/json" } },
    });

    expect(executeMock).toHaveBeenCalledOnce();
    expect(executeMock.mock.calls[0][0].body.input.find((item) => item.type === "custom_tool_call").name)
      .toBe("foo.bar");
  });

  it("restores a native custom tool name after executor aliasing", async () => {
    executeMock.mockClear();
    executeMock.mockImplementationOnce(async ({ body, credentials }) => {
      new CodexExecutor().transformRequest("gpt-6-luna", body, true, credentials);
      const sentName = body.input.find((item) => item.type === "additional_tools")
        .tools.find((tool) => tool.type === "custom").name;
      expect(sentName).toBe("foo_bar_2");
      const output = [{ type: "custom_tool_call", call_id: "call_exec", name: sentName, input: "run" }];
      const raw = [
        `event: response.completed`,
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_custom", status: "completed", output } })}`,
        "",
        "data: [DONE]",
        "",
      ].join("\n");
      return {
        response: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
        url: "http://codex/responses",
        headers: {},
        transformedBody: body,
      };
    });

    const result = await handleChatCore({
      body: {
        model: "codex/gpt-6-luna",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "run" }] }],
        stream: false,
        tools: [
          { type: "custom", name: "foo.bar", format: { type: "text" } },
          { type: "function", name: "foo_bar", parameters: { type: "object", properties: {} } },
        ],
      },
      modelInfo: { provider: "codex", model: "gpt-6-luna" },
      credentials: { providerSpecificData: {} },
      sourceFormatOverride: FORMATS.OPENAI_RESPONSES,
      clientRawRequest: { endpoint: "/v1/responses", headers: { "user-agent": "codex-cli/0.155.0", accept: "application/json" } },
    });

    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.output[0].name).toBe("foo.bar");
  });
});
