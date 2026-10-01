import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";

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
  it.each([true, false])("preserves explicit strict=%s for flat and nested function tools", (strict) => {
    const parameters = { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false };
    for (const tool of [
      { type: "function", name: "Monitor", parameters, strict },
      { type: "function", function: { name: "Monitor", parameters, strict } },
    ]) {
      expect(normalizeTools([structuredClone(tool)])[0]).toMatchObject({ strict, parameters });
    }
  });

  it("leaves unspecified strict unchanged on native Responses tools", () => {
    expect(normalizeTools([{ type: "function", name: "native", parameters: { type: "object", properties: {} } }])[0]).not.toHaveProperty("strict");
  });

  it.each([undefined, false, true])("keeps Monitor optional inputs across Claude to Codex with strict=%s", (strict) => {
    const schema = {
      type: "object",
      properties: {
        description: { type: "string" },
        command: { type: "string" },
        ws: { type: "object", properties: { url: { type: "string" }, protocols: { type: "array", items: { type: "string" } } }, required: ["url"] },
      },
      required: ["description"],
    };
    const tool = { name: "Monitor", description: "Use exactly one of command or ws", input_schema: schema };
    if (strict !== undefined) tool.strict = strict;
    const request = translateRequest("claude", "openai-responses", "gpt-5.5", {
      messages: [{ role: "user", content: "Monitor using a command only" }],
      tools: [tool],
    }, true, {}, "codex");
    const [out] = normalizeTools(request.tools);
    expect(out.strict).toBe(strict ?? false);
    expect(out.parameters).toEqual(schema);
    expect(out.parameters.required).not.toContain("ws");
  });

  it("preserves non-strict Chat Completions defaults when translating to Responses", () => {
    const request = translateRequest("openai", "openai-responses", "gpt-5.5", {
      messages: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "optional", parameters: { type: "object", properties: { value: { type: "string" } } } } }],
    }, true, {}, "codex");
    expect(normalizeTools(request.tools)[0].strict).toBe(false);
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
});
