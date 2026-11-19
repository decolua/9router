import { describe, it, expect, vi, beforeEach } from "vitest";
import "../translator/registerAll.js";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
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

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
  createSSETransformStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("handleChatCore Headroom diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/v1/compress")) {
        throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), { code: "ECONNREFUSED" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });
  });

  it("logs why Headroom was skipped on chat completions", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

    await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: false,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "application/json" },
      },
    });

    expect(log.warn).toHaveBeenCalledWith(
      "HEADROOM",
      expect.stringContaining("skipped: request failed")
    );
    expect(log.warn).toHaveBeenCalledWith(
      "HEADROOM",
      expect.stringContaining("ECONNREFUSED")
    );
    expect(log.warn).toHaveBeenCalledWith(
      "HEADROOM",
      expect.stringContaining("http://localhost:8787/v1/compress")
    );
  });

  it("scrubs credentials and query strings from Headroom fetch errors", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

    global.fetch = vi.fn(async () => {
      throw new Error("failed to fetch https://user:secret@example.com:8787/proxy/v1/compress?token=abc123");
    });

    await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      headroomEnabled: true,
      headroomUrl: "https://user:secret@example.com:8787/proxy?token=abc123",
      headroomCompressUserMessages: false,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "application/json" },
      },
    });

    const logs = JSON.stringify(log.warn.mock.calls);
    expect(logs).toContain("https://example.com:8787/proxy/v1/compress");
    expect(logs).not.toContain("user");
    expect(logs).not.toContain("secret");
    expect(logs).not.toContain("abc123");
  });

  it("masks credentials and query strings in Headroom endpoint diagnostics", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

    await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      headroomEnabled: true,
      headroomUrl: "https://user:secret@example.com:8787/proxy?token=abc123",
      headroomCompressUserMessages: false,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "application/json" },
      },
    });

    const logs = JSON.stringify(log.warn.mock.calls);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://user:secret@example.com:8787/proxy/v1/compress?token=abc123",
      expect.any(Object)
    );
    expect(logs).toContain("https://example.com:8787/proxy/v1/compress");
    expect(logs).not.toContain("user");
    expect(logs).not.toContain("secret");
    expect(logs).not.toContain("abc123");
  });

  it.each([["openai", "gpt-4o"], ["commandcode", "test-model"]])("sends Headroom-compressed messages to the %s executor", async (provider, model) => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const original = "very large context that should be replaced";
    const compressed = "compressed context";

    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/v1/compress")) {
        return new Response(JSON.stringify({
          messages: [{ role: "user", content: compressed }],
          tokens_before: 100,
          tokens_after: 10,
          tokens_saved: 90,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await handleChatCore({
      body: { model, stream: false, messages: [{ role: "user", content: original }] },
      modelInfo: { provider, model },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: false,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "application/json" },
      },
    });

    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining(provider === "commandcode"
        ? { params: expect.objectContaining({ messages: [{ role: "user", content: [{ type: "text", text: compressed }] }] }) }
        : { messages: [{ role: "user", content: compressed }] }),
    }));
    expect(JSON.stringify(executeMock.mock.calls[0][0].body)).not.toContain(original);
    expect(log.info).toHaveBeenCalledWith("HEADROOM", expect.stringContaining("reported token delta=90 before=100 after=10"));
    expect(log.info).toHaveBeenCalledWith("HEADROOM", expect.stringContaining("body="));
    expect(log.info).toHaveBeenCalledWith("HEADROOM", expect.stringContaining("messages="));

    const logs = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls]);
    expect(logs).not.toContain("saved");
    expect(logs).not.toContain(original);
  });

  it("sends compressed Responses tool output through the Antigravity translator to its executor", async () => {
    const original = "search output ".repeat(1000);
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    global.fetch = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      return new Response(JSON.stringify({
        messages: payload.messages.map((message) => ({ ...message, content: "short result" })),
        tokens_before: 1000, tokens_after: 10, tokens_saved: 990,
      }));
    });

    await handleChatCore({
      body: {
        model: "gemini-2.5-flash", stream: true,
        input: [
          { type: "function_call", call_id: "call_1", name: "search", arguments: '{"query":"symbol"}' },
          { type: "function_call_output", call_id: "call_1", output: original },
          { role: "user", content: "continue" },
        ],
        tools: [{ type: "function", name: "search", parameters: { type: "object" } }],
      },
      modelInfo: { provider: "antigravity", model: "gemini-2.5-flash" },
      credentials: { accessToken: "test-token", projectId: "test-project" },
      sourceFormatOverride: "openai-responses",
      log, connectionId: "test-conn", headroomEnabled: true, headroomUrl: "http://localhost:8787",
      rtkEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
      clientRawRequest: { endpoint: "/v1/responses", body: {}, headers: {} },
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    expect(executeMock).toHaveBeenCalledOnce();
    const outbound = executeMock.mock.calls[0][0].body;
    const parts = outbound.request.contents.flatMap((content) => content.parts);
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ functionResponse: expect.objectContaining({ id: "call_1", response: { result: { result: "short result" } } }) }),
      expect.objectContaining({ functionCall: expect.objectContaining({ name: "search", args: { query: "symbol" } }) }),
    ]));
    expect(JSON.stringify(outbound)).not.toContain(original);
    expect(log.info).toHaveBeenCalledWith("HEADROOM", expect.stringContaining("reported token delta=990"));
  });

  it.each(["anthropic", "claude"])("preserves Claude PDFs and tool results through Headroom to the %s executor", async (provider) => {
    const model = "claude-sonnet-4-5";
    const document = { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" }, title: "report.pdf" };
    const toolUse = { type: "tool_use", id: "toolu_pdf", name: "read_pdf", input: { path: "report.pdf" } };
    const messages = [
      { role: "user", content: [{ type: "text", text: "Summarize the attached PDF document" }, document] },
      { role: "assistant", content: [toolUse] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_pdf", content: [
        { type: "text", text: "Long extracted PDF contents" }, document,
      ] }] },
    ];
    const expected = structuredClone(messages);
    expected[0].content[0].text = "short";
    expected[2].content[0].content[0].text = "short";
    expected[1].content[0].cache_control = { type: "ephemeral" };
    expected[2].content[0].cache_control = { type: "ephemeral" };
    global.fetch = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      return Response.json({
        messages: payload.messages.map((message) => ({ ...message, content: message.content ? "short" : "" })),
        tokens_before: 100, tokens_after: 10, tokens_saved: 90,
      });
    });

    await handleChatCore({
      body: { model, stream: false, max_tokens: 2048, messages, tools: [{ name: "read_pdf", input_schema: { type: "object" } }] },
      modelInfo: { provider, model }, sourceFormatOverride: "claude",
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, connectionId: "test-conn",
      headroomEnabled: true, headroomUrl: "http://localhost:8787", headroomCompressUserMessages: true,
      rtkEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
      clientRawRequest: { endpoint: "/v1/messages", body: {}, headers: {} },
    });

    expect(global.fetch).toHaveBeenCalledOnce();
    expect(executeMock).toHaveBeenCalledOnce();
    expect(executeMock.mock.calls[0][0].body.messages).toEqual(expected);
  });

  it("does not warn about healthy message compression when tools dominate the body", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const original = "x".repeat(1000);
    const compressed = "x".repeat(500);
    const tools = [{
      type: "function",
      function: { name: "lookup", description: "tool description".repeat(10000) },
    }];
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: compressed }],
      tokens_before: 1000,
      tokens_after: 500,
      tokens_saved: 500,
    }), { status: 200 }));

    await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: original }], tools },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "application/json" },
      },
    });

    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        messages: [{ role: "user", content: compressed }],
        tools,
      }),
    }));
    expect(log.warn.mock.calls.filter(([tag]) => tag === "HEADROOM")).toEqual([]);
    expect(log.info).toHaveBeenCalledWith("HEADROOM", expect.stringContaining("effective=0.3%"));
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(tools[0].function.description);
  });

  it("discards Headroom rewrites when the outbound body barely shrinks", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const original = "x".repeat(1000);
    const nearlySame = "x".repeat(990);

    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/v1/compress")) {
        return new Response(JSON.stringify({
          messages: [{ role: "user", content: nearlySame }],
          tokens_before: 1000,
          tokens_after: 100,
          tokens_saved: 900,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: original }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: false,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "application/json" },
      },
    });

    expect(log.warn).toHaveBeenCalledWith(
      "HEADROOM",
      expect.stringContaining("discarded rewrite because outbound JSON shrank <5%; preserving provider prompt cache")
    );
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        messages: [{ role: "user", content: original }],
      }),
    }));
  });

  it("retries rejected compressed Responses with the saved original body and provider overrides", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const original = "large original Responses context ".repeat(100);
    const compressed = "compressed context";
    const providerOverrides = { reasoningEffort: "high" };

    global.fetch = vi.fn(async (_url, init) => {
      const { messages } = JSON.parse(init.body);
      return Response.json({
        messages: messages.map((message) => ({ ...message, content: compressed })),
        tokens_before: 1000,
        tokens_after: 100,
        tokens_saved: 900,
      });
    });
    executeMock
      .mockResolvedValueOnce({
        response: new Response(JSON.stringify({ error: { message: "Bad Request" } }), { status: 400 }),
        url: "https://compatible.test/v1/responses",
        headers: {},
        transformedBody: null,
      })
      .mockResolvedValueOnce({
        response: Response.json({
          id: "resp_test",
          object: "response",
          status: "completed",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] }],
          usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
        }),
        url: "https://compatible.test/v1/responses",
        headers: {},
        transformedBody: null,
      });

    const request = {
      body: {
        model: "test-model",
        stream: false,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: original }] }],
      },
      modelInfo: { provider: "openai-compatible-chat-test", model: "test-model" },
      credentials: {
        apiKey: "test-key",
        providerSpecificData: { apiType: "auto", baseUrl: "https://compatible.test/v1" },
      },
      providerOverrides,
      log,
      connectionId: "test-conn",
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: true,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      customPromptEnabled: true,
      customPrompt: "Keep Responses instructions intact",
      sourceFormatOverride: "openai-responses",
      clientRawRequest: { endpoint: "/v1/responses", body: {}, headers: { accept: "application/json" } },
    };

    await handleChatCore(request);

    expect(executeMock).toHaveBeenCalledTimes(2);
    const [compressedRequest, fallbackRequest] = executeMock.mock.calls.map(([args]) => args);
    expect(compressedRequest.body.input.find((item) => item.role === "user").content[0].text).toBe(compressed);
    expect(fallbackRequest.body.input.find((item) => item.role === "user").content[0].text).toBe(original);
    expect(fallbackRequest.body.input.some((item) => item.role === "system"
      && item.content[0].text === "Keep Responses instructions intact")).toBe(true);
    expect(fallbackRequest.providerOverrides).toBe(providerOverrides);
    expect(log.warn).toHaveBeenCalledWith(
      "HEADROOM",
      "upstream rejected compressed Responses payload with 400; retrying once without Headroom"
    );
  });

  it("bypasses token savers when requested by the client", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const pxpipeTransform = vi.fn();
    const messages = [{ role: "user", content: "Write polished prose." }];

    global.fetch = vi.fn(async (url) => {
      throw new Error(`unexpected fetch: ${url}`);
    });

    await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: true,
      rtkEnabled: true,
      cavemanEnabled: true,
      cavemanLevel: "full",
      ponytailEnabled: true,
      ponytailLevel: "full",
      pxpipeEnabled: true,
      pxpipeTransform,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: {
          accept: "application/json",
          "x-9router-token-saver": "off",
        },
      },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(pxpipeTransform).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        messages: [{ role: "user", content: "Write polished prose." }],
      }),
    }));
  });
});
