import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

import { CodexExecutor } from "../../open-sse/executors/codex.js";

beforeEach(() => fetchMock.mockReset());

function normalizeTools(tools) {
  const executor = new CodexExecutor();
  const body = {
    model: "gpt-5.5",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "probe" }] }],
    tools,
    stream: true,
  };

  executor.transformRequest("gpt-5.5", body, true, {
    connectionId: "test-codex-tools",
    providerSpecificData: {},
  });

  return body.tools;
}

describe("CodexExecutor tool normalization", () => {
  it("preserves the official Responses Lite transport contract", () => {
    const executor = new CodexExecutor();
    const credentials = {
      connectionId: "responses-lite",
      rawHeaders: {
        "x-openai-internal-codex-responses-lite": "true",
        "user-agent": "codex_exec/0.144.1",
        originator: "codex_exec",
        "x-client-request-id": "request-id",
        "x-codex-turn-metadata": "turn-metadata",
        authorization: "Bearer client-secret",
        cookie: "session=client-secret",
        "proxy-authorization": "Basic client-secret",
        "x-api-key": "client-secret",
        "x-forwarded-for": "203.0.113.1",
      },
    };
    const body = {
      model: "gpt-5.6-sol",
      input: [
        { type: "additional_tools", role: "developer", tools: [{ type: "function", name: "probe", parameters: {} }] },
        { type: "message", role: "developer", content: [{ type: "input_text", text: "instructions" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
      reasoning: { effort: "max", summary: "auto" },
      stream: true,
    };

    executor.transformRequest("gpt-5.6-sol", body, true, credentials);
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["x-openai-internal-codex-responses-lite"]).toBe("true");
    expect(headers["User-Agent"]).toBe("codex_exec/0.144.1");
    expect(headers["x-client-request-id"]).toBe("request-id");
    expect(headers["x-codex-turn-metadata"]).toBe("turn-metadata");
    for (const name of ["authorization", "cookie", "proxy-authorization", "x-api-key", "x-forwarded-for"]) {
      expect(headers[name]).toBeUndefined();
    }
    expect(body.instructions).toBeUndefined();
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.input[0].type).toBe("additional_tools");
    expect(body.reasoning.context).toBe("all_turns");
  });

  it("disables parallel tool calls required by Responses Lite", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.6-sol",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      parallel_tool_calls: true,
      reasoning: { effort: "max", summary: "auto" },
      stream: true,
    };

    executor.transformRequest("gpt-5.6-sol", body, true, {
      connectionId: "responses-lite-parallel",
      rawHeaders: { "x-openai-internal-codex-responses-lite": "true" },
    });

    expect(body.parallel_tool_calls).toBe(false);
  });

  it("keeps Responses Lite compact requests unary and compact-only", () => {
    const executor = new CodexExecutor();
    const credentials = {
      connectionId: "responses-lite-compact",
      rawHeaders: { "x-openai-internal-codex-responses-lite": "true" },
    };
    const body = {
      _compact: true,
      model: "gpt-5.6-sol",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      parallel_tool_calls: false,
      reasoning: { effort: "max", summary: "auto", context: "current_turn" },
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      client_metadata: { thread_id: "test" },
    };

    executor.transformRequest("gpt-5.6-sol", body, false, credentials);
    const headers = executor.buildHeaders(credentials, false);

    expect(executor.buildUrl("gpt-5.6-sol", false)).toBe("https://chatgpt.com/backend-api/codex/responses/compact");
    executor.transformRequest("gpt-5.6-sol", body, false, credentials);
    expect(executor.buildUrl("gpt-5.6-sol", false)).toBe("https://chatgpt.com/backend-api/codex/responses/compact");
    expect(headers["x-openai-internal-codex-responses-lite"]).toBe("true");
    expect(headers.Accept).toBeUndefined();
    expect(body.stream).toBeUndefined();
    expect(body.store).toBeUndefined();
    expect(body.include).toBeUndefined();
    expect(body.client_metadata).toBeUndefined();
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.reasoning.context).toBe("all_turns");
  });

  it("routes concurrent compact and standard requests independently", async () => {
    const executor = new CodexExecutor();
    const credentials = {
      apiKey: "test-key",
      connectionId: "responses-lite-url",
      rawHeaders: { "x-openai-internal-codex-responses-lite": "true" },
    };
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await Promise.all([
      executor.execute({
        model: "gpt-5.6-sol",
        body: { _compact: true, model: "gpt-5.6-sol", input: "compact me" },
        stream: false,
        credentials,
      }),
      executor.execute({
        model: "gpt-5.6-sol",
        body: { model: "gpt-5.6-sol", input: "continue" },
        stream: true,
        credentials,
      }),
    ]);

    const urlsByInput = Object.fromEntries(fetchMock.mock.calls.map(([url, options]) => {
      const request = JSON.parse(options.body);
      return [request.input[0].content[0].text, url];
    }));
    expect(urlsByInput).toEqual({
      "compact me": "https://chatgpt.com/backend-api/codex/responses/compact",
      continue: "https://chatgpt.com/backend-api/codex/responses",
    });
  });

  it("does not forward Responses Lite without the client opt-in header", () => {
    const executor = new CodexExecutor();
    const credentials = { connectionId: "standard-responses", rawHeaders: {} };
    const body = { model: "gpt-5.6-sol", input: "hello" };

    executor.transformRequest("gpt-5.6-sol", body, true, credentials);
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
    expect(body.instructions).toBeTruthy();
  });

  it("preserves Responses text.format for structured outputs", () => {
    const executor = new CodexExecutor();
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
    };
    const body = {
      model: "gpt-5.4-mini",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "test for session title" }] }],
      stream: true,
      metadata: { unsupported: true },
      text: {
        format: {
          type: "json_schema",
          name: "codex_output_schema",
          strict: true,
          schema,
        },
      },
    };

    executor.transformRequest("gpt-5.4-mini", body, true, {
      connectionId: "test-codex-structured-output",
      providerSpecificData: {},
    });

    expect(body.text).toEqual({
      format: {
        type: "json_schema",
        name: "codex_output_schema",
        strict: true,
        schema,
      },
    });
    expect(body.metadata).toBeUndefined();
  });

  it("preserves Responses-native tool_search tools", () => {
    const tools = normalizeTools([
      {
        type: "tool_search",
        execution: "sync",
        description: "Discover deferred tools",
        parameters: { type: "object", properties: {} },
      },
      {
        type: "namespace",
        name: "codex_app",
        description: "app tools",
        tools: [
          {
            type: "function",
            name: "automation_update",
            description: "automation",
            parameters: { type: "object", properties: {} },
            defer_loading: true,
          },
        ],
      },
      {
        type: "function",
        name: "plain_fn",
        description: "plain",
        parameters: { type: "object", properties: {} },
      },
    ]);

    expect(tools.map((tool) => `${tool.type}:${tool.name || ""}`)).toEqual([
      "tool_search:",
      "namespace:codex_app",
      "function:plain_fn",
    ]);
  });

  it("preserves hosted Responses tools", () => {
    const tools = normalizeTools([
      { type: "web_search", search_context_size: "medium" },
      { type: "image_generation", size: "1024x1024" },
      { type: "mcp", server_label: "docs", server_url: "https://example.com/mcp" },
      { type: "local_shell" },
      { type: "code_interpreter", container: { type: "auto" } },
      { type: "computer", display_width: 1024, display_height: 768, environment: "browser" },
    ]);

    expect(tools.map((tool) => tool.type)).toEqual([
      "web_search",
      "image_generation",
      "mcp",
      "local_shell",
      "code_interpreter",
      "computer",
    ]);
  });

  it("preserves custom freeform tools with format payloads", () => {
    const tools = normalizeTools([
      {
        type: "custom",
        name: "apply_patch",
        description: "patch",
        format: { type: "grammar", syntax: "lark", definition: "start: /.+/" },
      },
    ]);

    expect(tools).toEqual([
      {
        type: "custom",
        name: "apply_patch",
        description: "patch",
        format: { type: "grammar", syntax: "lark", definition: "start: /.+/" },
      },
    ]);
  });
});
