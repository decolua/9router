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

  it("strips uniqueItems recursively across properties, items, combinators, $defs, and namespaces while preserving literal property names and data", () => {
    const sourceParameters = {
      type: "object",
      required: ["tags", "uniqueItems"],
      properties: {
        tags: { type: "array", items: { type: "string" }, uniqueItems: true },
        nested: {
          type: "array",
          items: {
            type: "object",
            properties: { ids: { type: "array", items: { type: "integer" }, uniqueItems: true } },
          },
        },
        combo: {
          anyOf: [
            { type: "array", items: { type: "string" }, uniqueItems: true },
            { type: "string" },
          ],
          oneOf: [{ $ref: "#/$defs/UniqueList" }],
        },
        uniqueItems: {
          type: "boolean",
          default: { uniqueItems: true },
          enum: [{ uniqueItems: false }],
        },
        data: {
          type: "object",
          properties: {
            uniqueItems: { type: "array", items: { type: "string" }, uniqueItems: false },
          },
        },
      },
      $defs: {
        UniqueList: { type: "array", items: { type: "string" }, uniqueItems: false },
      },
    };
    const nestedParams = {
      type: "object",
      properties: { items: { type: "array", items: { type: "string" }, uniqueItems: true } },
    };
    const tools = normalizeTools([
      { type: "function", name: "flat_tool", strict: true, parameters: sourceParameters },
      { type: "function", function: { name: "nested_tool", parameters: nestedParams } },
      {
        type: "namespace",
        name: "ns",
        tools: [{
          type: "function",
          name: "ns_fn",
          parameters: {
            type: "object",
            properties: { list: { type: "array", items: { type: "string" }, uniqueItems: true } },
          },
        }],
      },
    ]);

    const flatParams = tools[0].parameters;
    expect(flatParams.required).toEqual(["tags", "uniqueItems"]);
    expect(tools[0].strict).toBe(true);
    expect(flatParams.properties.tags).toEqual({ type: "array", items: { type: "string" } });
    expect(flatParams.properties.nested.items.properties.ids).toEqual({ type: "array", items: { type: "integer" } });
    expect(flatParams.properties.combo.anyOf[0]).toEqual({ type: "array", items: { type: "string" } });
    expect(flatParams.$defs.UniqueList).toEqual({ type: "array", items: { type: "string" } });
    expect(flatParams.properties.uniqueItems).toEqual({
      type: "boolean",
      default: { uniqueItems: true },
      enum: [{ uniqueItems: false }],
    });
    expect(flatParams.properties.data).toEqual({
      type: "object",
      properties: {
        uniqueItems: { type: "array", items: { type: "string" } },
      },
    });
    expect(tools[1].parameters.properties.items).toEqual({ type: "array", items: { type: "string" } });
    expect(tools[2].tools[0].parameters.properties.list).toEqual({ type: "array", items: { type: "string" } });
    expect(sourceParameters.properties.tags.uniqueItems).toBe(true);
    expect(sourceParameters.properties.data.properties.uniqueItems.uniqueItems).toBe(false);
    expect(sourceParameters.$defs.UniqueList.uniqueItems).toBe(false);
    expect(nestedParams.properties.items.uniqueItems).toBe(true);
  });

  it.each(["gpt-6.2-sol", "gpt-6.2-astra"])("sanitizes uniqueItems in serialized outbound tools for %s", (model) => {
    const executor = new CodexExecutor();
    const sourceParameters = {
      type: "object",
      properties: {
        targets: { type: "array", items: { type: "string" }, uniqueItems: true },
        uniqueItems: { type: "boolean", default: { uniqueItems: true } },
      },
      required: ["targets"],
    };
    const body = {
      model,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "run" }] }],
      tools: [{
        type: "function",
        name: "openclaw_action",
        parameters: sourceParameters,
      }],
      stream: true,
    };

    executor.transformRequest(model, body, true, {
      connectionId: "test-codex-62",
      providerSpecificData: {},
    });

    const additionalTools = body.input.find((item) => item?.type === "additional_tools");
    expect(additionalTools).toBeDefined();
    const serialized = JSON.stringify(additionalTools.tools);
    const parsed = JSON.parse(serialized);
    expect(parsed[0].parameters.properties.targets).toEqual({ type: "array", items: { type: "string" } });
    expect(parsed[0].parameters.properties.uniqueItems).toEqual({ type: "boolean", default: { uniqueItems: true } });
    expect(sourceParameters.properties.targets.uniqueItems).toBe(true);
  });
});
