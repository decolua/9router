import { describe, expect, it, vi } from "vitest";
import { normalizeToolSchemasForProvider } from "../../open-sse/utils/toolSchemaCompatibility.js";

const tools = [{
  type: "function",
  function: {
    name: "find_files",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", pattern: "^[a-z]+$" },
        nested: {
          type: "object",
          properties: { value: { type: "string", pattern: "[" } },
        },
      },
      required: ["pattern"],
    },
  },
}];

describe("normalizeToolSchemasForProvider", () => {
  it("removes malformed regex constraints for OpenRouter while preserving valid schemas", () => {
    const normalized = normalizeToolSchemasForProvider("openrouter", tools);
    const parameters = normalized[0].function.parameters;

    expect(parameters.required).toEqual(["pattern"]);
    expect(parameters.properties.pattern).toEqual({ type: "string", pattern: "^[a-z]+$" });
    expect(parameters.properties.nested.properties.value).toEqual({ type: "string" });
    expect(tools[0].function.parameters.properties.pattern.pattern).toBe("^[a-z]+$");
  });

  it("normalizes invalid patterns in array and composition schemas without mutating input", () => {
    const schemaTools = [{
      type: "function",
      function: {
        name: "search",
        parameters: {
          type: "object",
          properties: {
            filters: {
              type: "array",
              items: { type: "string", pattern: "[" },
            },
            alternatives: {
              anyOf: [
                { type: "string", pattern: "^ok$" },
                { type: "string", pattern: "(" },
              ],
            },
          },
        },
      },
    }];

    const normalized = normalizeToolSchemasForProvider("openrouter", schemaTools);
    const properties = normalized[0].function.parameters.properties;

    expect(properties.filters.items).toEqual({ type: "string" });
    expect(properties.alternatives.anyOf).toEqual([
      { type: "string", pattern: "^ok$" },
      { type: "string" },
    ]);
    expect(schemaTools[0].function.parameters.properties.filters.items.pattern).toBe("[");
    expect(schemaTools[0].function.parameters.properties.alternatives.anyOf[1].pattern).toBe("(");
  });

  it("retains a schema property named pattern while removing its invalid constraint", () => {
    const normalized = normalizeToolSchemasForProvider("openrouter", [{
      type: "function",
      function: {
        name: "find",
        parameters: {
          type: "object",
          properties: { pattern: { type: "string", pattern: "[" } },
        },
      },
    }]);

    expect(normalized[0].function.parameters.properties.pattern).toEqual({ type: "string" });
  });

  it("does not modify schemas for other providers", () => {
    expect(normalizeToolSchemasForProvider("groq", tools)).toBe(tools);
  });

  it("handles a schema property literally named 'properties' without swallowing its own pattern", () => {
    // Regression case: a naive depth-tracking implementation can mistake a
    // property named "properties" for an actual JSON Schema properties map,
    // and skip validating a genuine `pattern` constraint one level below it.
    const normalized = normalizeToolSchemasForProvider("openrouter", [{
      type: "function",
      function: {
        name: "edit_css",
        parameters: {
          type: "object",
          properties: {
            properties: { type: "string", pattern: "[" },
            selector: { type: "string", pattern: "^[.#]?[a-z-]+$" },
          },
        },
      },
    }]);

    const props = normalized[0].function.parameters.properties;
    expect(props.properties).toEqual({ type: "string" });
    expect(props.selector).toEqual({ type: "string", pattern: "^[.#]?[a-z-]+$" });
  });

  it("logs a redacted count when patterns are removed, without leaking schema content", () => {
    const debug = vi.fn();
    normalizeToolSchemasForProvider("openrouter", [{
      type: "function",
      function: { name: "find", parameters: { type: "object", properties: { p: { type: "string", pattern: "[" } } } },
    }], { debug });

    expect(debug).toHaveBeenCalledTimes(1);
    const [tag, message] = debug.mock.calls[0];
    expect(tag).toBe("TOOLSCHEMA");
    expect(message).toContain("stripped 1 invalid pattern constraint");
    expect(message).not.toContain("[");
  });

  it("does not log when no patterns needed removal", () => {
    const debug = vi.fn();
    const validTools = [{
      type: "function",
      function: { name: "find", parameters: { type: "object", properties: { p: { type: "string", pattern: "^ok$" } } } },
    }];
    normalizeToolSchemasForProvider("openrouter", validTools, { debug });
    expect(debug).not.toHaveBeenCalled();
  });
});