import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

function normalizeTools(tools) {
  const executor = new CodexExecutor();
  const body = {
    model: "gpt-5.6-terra",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "probe" }] }],
    tools,
    stream: true,
  };

  executor.transformRequest("gpt-5.6-terra", body, true, {
    connectionId: "test-codex-tools",
    providerSpecificData: {},
  });

  return body.tools;
}

describe("CodexExecutor tool normalization", () => {
  it("preserves explicit strict flags without changing optional arguments", () => {
    const parameters = {
      type: "object",
      properties: { sessionID: { type: "string" } },
      required: [],
    };
    const tools = normalizeTools([
      { type: "function", name: "flat_false", strict: false, parameters },
      { type: "function", name: "flat_true", strict: true, parameters },
      { type: "function", function: { name: "nested_false", strict: false, parameters } },
      { type: "function", function: { name: "nested_true", strict: true, parameters } },
      { type: "function", name: "unspecified", parameters },
    ]);

    expect(tools.map((tool) => tool.strict)).toEqual([false, true, false, true, undefined]);
    for (const tool of tools) {
      expect(tool.parameters).toEqual(parameters);
      expect(tool.parameters.required).toEqual([]);
    }
    expect(tools[4]).not.toHaveProperty("strict");
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

  it("strips only Unicode-property patterns rejected by Codex", () => {
    const unicodePattern = "^(?!__.*__$)[^\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]{1,200}$";
    const validPattern = "^[a-z][a-z0-9_-]{0,31}$";
    const sourceParameters = {
      type: "object",
      properties: {
        artifact: {
          type: "object",
          properties: {
            name: { type: "string", pattern: unicodePattern },
            slug: { type: "string", pattern: validPattern },
          },
        },
        // A property named "pattern" is data, not the schema keyword.
        pattern: { type: "string", pattern: validPattern },
      },
      allOf: [{ properties: { title: { type: "string", pattern: unicodePattern } } }],
    };
    const tools = normalizeTools([{
      type: "function",
      name: "Artifact",
      parameters: sourceParameters,
    }]);

    expect(tools[0].parameters.properties.artifact.properties.name.pattern).toBeUndefined();
    expect(tools[0].parameters.properties.artifact.properties.slug.pattern).toBe(validPattern);
    expect(tools[0].parameters.properties.pattern.pattern).toBe(validPattern);
    expect(tools[0].parameters.allOf[0].properties.title.pattern).toBeUndefined();
    // Copy-on-write: the caller's schema remains available for another provider.
    expect(sourceParameters.properties.artifact.properties.name.pattern).toBe(unicodePattern);
  });

  it("keeps escaped literal property text and schema identity when no strip is needed", () => {
    const parameters = {
      type: "object",
      properties: {
        literal: { type: "string", pattern: "^\\\\p{Cc}$" },
        simple: { type: "string", pattern: "^[A-Z]+$" },
      },
    };
    const tools = normalizeTools([{ type: "function", name: "probe", parameters }]);

    expect(tools[0].parameters).toBe(parameters);
    expect(tools[0].parameters.properties.literal.pattern).toBe("^\\\\p{Cc}$");
  });

  it("sanitizes nested namespace function schemas", () => {
    const tools = normalizeTools([{
      type: "namespace",
      name: "agent",
      tools: [{
        type: "function",
        name: "Artifact",
        parameters: {
          type: "object",
          properties: { name: { type: "string", pattern: "^\\p{Cc}+$" } },
        },
      }],
    }]);

    expect(tools[0].tools[0].parameters.properties.name.pattern).toBeUndefined();
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
  it("preserves caller include fields when requiring encrypted reasoning", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.6-terra",
      input: "Return a tool result",
      include: ["code_interpreter_call.outputs"],
      reasoning: { effort: "low" },
    };

    executor.transformRequest("gpt-5.6-terra", body, true, {});

    expect(body.include).toEqual([
      "code_interpreter_call.outputs",
      "reasoning.encrypted_content",
    ]);
  });

  it("normalizes long native call IDs consistently across calls and results", () => {
    const shared = "provider:call_".repeat(8);
    const originalIds = [`${shared}alpha`, `${shared}beta`];
    const body = {
      model: "gpt-5.6-terra",
      input: originalIds.flatMap((call_id) => [
        { type: "function_call", call_id, name: "run", arguments: "{}" },
        { type: "function_call_output", call_id, output: "done" },
      ]),
    };

    new CodexExecutor().transformRequest("gpt-5.6-terra", body, true, {});

    const [callA, outputA, callB, outputB] = body.input;
    expect(callA.call_id).toBe(outputA.call_id);
    expect(callB.call_id).toBe(outputB.call_id);
    expect(callA.call_id).not.toBe(callB.call_id);
    for (const item of body.input) {
      expect(item.call_id.length).toBeLessThanOrEqual(64);
      expect(item.call_id).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it("correlates composite call IDs by their canonical prefix", () => {
    const body = {
      model: "gpt-5.6-terra",
      input: [
        { type: "function_call", call_id: "call_123|assistant_item", name: "run", arguments: "{}" },
        { type: "function_call_output", call_id: "call_123|output_item", output: "done" },
      ],
    };

    new CodexExecutor().transformRequest("gpt-5.6-terra", body, true, {});

    expect(body.input[0].call_id).toBe("call_123");
    expect(body.input[1].call_id).toBe(body.input[0].call_id);
  });

  it("repairs interrupted calls and orphaned tool results in native Responses history", () => {
    const body = {
      model: "gpt-5.6-terra",
      input: [
        { type: "function_call", call_id: "pending_fn", name: "run", arguments: "{}" },
        { type: "function_call_output", call_id: "orphan_output", output: "prior result" },
        { type: "custom_tool_call", call_id: "pending_custom", name: "apply_patch", input: "patch" },
        { type: "computer_call", call_id: "pending_computer" },
      ],
    };

    new CodexExecutor().transformRequest("gpt-5.6-terra", body, true, {});

    expect(body.input.map((item) => item.type)).toEqual([
      "function_call",
      "function_call_output",
      "message",
      "custom_tool_call",
      "custom_tool_call_output",
      "message",
    ]);
    expect(body.input[1].output).toContain("tool call was interrupted");
    expect(body.input[2].content).toContain("prior result");
    expect(body.input[4].output).toContain("tool call was interrupted");
    expect(body.input[5].content).toContain("Computer call interrupted");
  });

});
