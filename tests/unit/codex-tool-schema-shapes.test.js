import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

function normalizeTools(tools) {
  const executor = new CodexExecutor();
  const body = {
    model: "gpt-5.5",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "probe" }] }],
    tools,
    stream: true,
  };

  executor.transformRequest("gpt-5.5", body, true, {
    connectionId: "test-codex-tool-shapes",
    providerSpecificData: {},
  });

  return body.tools;
}

// The Responses validator requires every property value to be a Schema *object*:
//
//   400 Invalid schema for function 'X': 'object' is not of type 'object', 'boolean'
//   param: tools[71].parameters
//
// A bare type name where a Schema belongs fails the whole request on every
// account, so the combo pays a full failover for a deterministically malformed
// payload. Tuples (`items` as a list) are rejected the same way.
function findInvalidSchemaShapes(node, path = "$", found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((child, index) => findInvalidSchemaShapes(child, `${path}[${index}]`, found));
    return found;
  }

  if (Array.isArray(node.items)) found.push(`${path}.items is a list`);

  if (node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)) {
    for (const [name, value] of Object.entries(node.properties)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        found.push(`${path}.properties.${name} -> ${JSON.stringify(value)}`);
      } else {
        findInvalidSchemaShapes(value, `${path}.properties.${name}`, found);
      }
    }
  }

  if (node.items && !Array.isArray(node.items)) {
    findInvalidSchemaShapes(node.items, `${path}.items`, found);
  }

  return found;
}

describe("CodexExecutor tool schema shape coercion", () => {
  it("coerces a bare type name standing in for a property schema", () => {
    const tools = normalizeTools([{
      type: "function",
      name: "jira_get_issue",
      parameters: {
        type: "object",
        properties: {
          cloudId: { type: "string" },
          // The offending shape.
          value: "object",
        },
        required: ["cloudId"],
      },
    }]);

    expect(tools).toHaveLength(1);
    expect(findInvalidSchemaShapes(tools[0].parameters)).toEqual([]);
    expect(tools[0].parameters.properties.value).toMatchObject({ type: "object" });
  });

  it("coerces every known JSON Schema type name and degrades unknown ones", () => {
    const tools = normalizeTools([{
      type: "function",
      name: "probe_types",
      parameters: {
        type: "object",
        properties: {
          a: "string", b: "number", c: "integer",
          d: "boolean", e: "array", f: "object",
          odd: "not-a-real-type",
        },
      },
    }]);

    expect(findInvalidSchemaShapes(tools[0].parameters)).toEqual([]);
    for (const [name, type] of Object.entries({
      a: "string", b: "number", c: "integer", d: "boolean", e: "array", f: "object", odd: "string",
    })) {
      expect(tools[0].parameters.properties[name]).toMatchObject({ type });
    }
  });

  it("collapses a tuple `items` array to a single schema", () => {
    const tools = normalizeTools([{
      type: "function",
      name: "set_range",
      parameters: {
        type: "object",
        properties: {
          range: { type: "array", items: [{ type: "number" }, { type: "integer" }] },
        },
      },
    }]);

    expect(findInvalidSchemaShapes(tools[0].parameters)).toEqual([]);
    expect(Array.isArray(tools[0].parameters.properties.range.items)).toBe(false);
    expect(tools[0].parameters.properties.range.items).toBeTypeOf("object");
  });

  it("drops a tuple `items` array that carries no usable schema", () => {
    const tools = normalizeTools([{
      type: "function",
      name: "junk_tuple",
      parameters: {
        type: "object",
        properties: { junk: { type: "array", items: [null, "not-a-schema"] } },
      },
    }]);

    expect(findInvalidSchemaShapes(tools[0].parameters)).toEqual([]);
    // `items` is simply removed; OpenAI does not require it on every array.
    expect(tools[0].parameters.properties.junk.items).toBeUndefined();
  });

  it("coerces nested free-form values in deep tool schemas", () => {
    const tools = normalizeTools([{
      type: "function",
      name: "deep",
      parameters: {
        type: "object",
        properties: {
          root: "object",
          list: {
            type: "array",
            items: {
              type: "object",
              properties: { inner: "object", tuple: { type: "array", items: ["string", "integer"] } },
            },
          },
        },
      },
    }]);

    expect(findInvalidSchemaShapes(tools[0].parameters)).toEqual([]);
  });

  it("leaves a property literally named `properties` alone", () => {
    const tools = normalizeTools([{
      type: "function",
      name: "props",
      parameters: {
        type: "object",
        properties: {
          properties: { type: "object", properties: { inner: "string" } },
        },
      },
    }]);

    expect(findInvalidSchemaShapes(tools[0].parameters)).toEqual([]);
    expect(tools[0].parameters.properties.properties.properties.inner).toEqual({ type: "string" });
  });

  it("sanitizes the same shapes inside nested namespace tools", () => {
    const tools = normalizeTools([{
      type: "namespace",
      name: "atlassian",
      tools: [{
        type: "function",
        name: "jira_search",
        parameters: {
          type: "object",
          properties: { value: "object", range: { type: "array", items: ["string", "string"] } },
        },
      }],
    }]);

    expect(findInvalidSchemaShapes(tools[0].tools[0].parameters)).toEqual([]);
  });

  it("preserves schema identity when nothing needs coercion", () => {
    const parameters = {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    };
    const tools = normalizeTools([{ type: "function", name: "weather", parameters }]);

    // Copy-on-write: an already-compatible schema keeps its identity.
    expect(tools[0].parameters).toBe(parameters);
  });

  it("strips rejected `pattern` escapes and coerces shapes in the same pass", () => {
    const tools = normalizeTools([{
      type: "function",
      name: "mixed",
      parameters: {
        type: "object",
        properties: {
          value: "object",
          name: { type: "string", pattern: "^(?!__.*__$)[^\\p{Cc}]{1,200}$" },
        },
      },
    }]);

    expect(findInvalidSchemaShapes(tools[0].parameters)).toEqual([]);
    expect(tools[0].parameters.properties.name.pattern).toBeUndefined();
    expect(tools[0].parameters.properties.value).toMatchObject({ type: "object" });
  });
});
