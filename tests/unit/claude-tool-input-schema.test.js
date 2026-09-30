import { describe, expect, it } from "vitest";

import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const createUpdateSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        mode: { const: "create" },
        name: { type: "string", description: "Name to create" },
      },
      required: ["mode", "name"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        mode: { const: "update" },
        id: { type: "string", description: "Record to update" },
      },
      required: ["mode", "id"],
      additionalProperties: false,
    },
  ],
};

describe("Claude tool input schemas", () => {
  it("flattens a Codex namespace tool's root oneOf without changing the Chat schema or argument shape", () => {
    const body = {
      input: "Update a record",
      tools: [{
        type: "namespace",
        name: "mcp__codex_app",
        tools: [{
          type: "function",
          name: "automation_update",
          parameters: createUpdateSchema,
        }],
      }],
    };

    const chat = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "test-model", structuredClone(body), true, {});
    expect(chat.tools[0].function.parameters).toEqual(createUpdateSchema);

    const claude = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "claude-sonnet-4", structuredClone(body), true, { apiKey: "test-key" }, "claude");
    const schema = claude.tools[0].input_schema;
    expect(claude.tools[0].name).toBe("mcp__codex_app__automation_update");
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("oneOf");
    expect(schema).not.toHaveProperty("allOf");
    expect(schema).not.toHaveProperty("anyOf");
    expect(Object.keys(schema.properties).sort()).toEqual(["id", "mode", "name"]);
    expect(JSON.stringify(schema.properties.mode)).toContain("create");
    expect(JSON.stringify(schema.properties.mode)).toContain("update");
    expect(schema.required).toEqual(["mode"]);
    expect(schema.additionalProperties).toBe(false);
    expect(body.tools[0].tools[0].parameters).toEqual(createUpdateSchema);
  });

  it("combines allOf object fields and requirements at the root", () => {
    const inputSchema = {
      type: "object",
      properties: { base: { type: "boolean" } },
      required: ["base"],
      allOf: [
        { type: "object", properties: { left: { type: "string" } }, required: ["left"] },
        { type: "object", properties: { right: { type: "number" } }, required: ["right"] },
      ],
    };
    const body = { model: "claude-sonnet-4", tools: [{ name: "combined", input_schema: inputSchema }] };
    prepareClaudeRequest(body, "claude");

    expect(body.tools[0].input_schema).toMatchObject({
      type: "object",
      properties: {
        base: { type: "boolean" },
        left: { type: "string" },
        right: { type: "number" },
      },
      required: ["base", "left", "right"],
    });
    expect(body.tools[0].input_schema).not.toHaveProperty("allOf");
    expect(inputSchema).toHaveProperty("allOf");
  });

  it("resolves local references in root anyOf and leaves nested unions intact", () => {
    const inputSchema = {
      $defs: {
        first: {
          type: "object",
          properties: {
            kind: { const: "first" },
            value: { oneOf: [{ type: "string" }, { type: "number" }] },
          },
          required: ["kind"],
        },
        second: {
          type: "object",
          properties: { kind: { const: "second" }, flag: { type: "boolean" } },
          required: ["kind"],
        },
      },
      anyOf: [{ $ref: "#/$defs/first" }, { $ref: "#/$defs/second" }],
    };
    const body = { model: "claude-sonnet-4", tools: [{ name: "with_refs", input_schema: inputSchema }] };
    prepareClaudeRequest(body, "claude");

    const schema = body.tools[0].input_schema;
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("anyOf");
    expect(Object.keys(schema.properties).sort()).toEqual(["flag", "kind", "value"]);
    expect(schema.properties.value.oneOf).toEqual([{ type: "string" }, { type: "number" }]);
    expect(schema.required).toEqual(["kind"]);
    expect(inputSchema.anyOf).toEqual([{ $ref: "#/$defs/first" }, { $ref: "#/$defs/second" }]);
  });

  it("bounds recursive root references instead of looping while preparing a tool", () => {
    const inputSchema = {
      $defs: {
        recursive: { oneOf: [{ $ref: "#/$defs/recursive" }] },
      },
      oneOf: [{ $ref: "#/$defs/recursive" }],
    };
    const body = { model: "claude-sonnet-4", tools: [{ name: "recursive", input_schema: inputSchema }] };
    expect(() => prepareClaudeRequest(body, "claude")).not.toThrow();
    expect(body.tools[0].input_schema.type).toBe("object");
    expect(body.tools[0].input_schema).not.toHaveProperty("oneOf");
  });

  it("normalizes a custom-wrapped Claude tool schema", () => {
    const body = {
      model: "claude-sonnet-4",
      tools: [{ type: "custom", custom: { name: "automation_update", input_schema: createUpdateSchema } }],
    };
    prepareClaudeRequest(body, "claude");
    expect(body.tools[0].custom.input_schema.type).toBe("object");
    expect(body.tools[0].custom.input_schema).not.toHaveProperty("oneOf");
    expect(body.tools[0].custom.input_schema.required).toEqual(["mode"]);
  });

  it("treats special property names as data while merging variants", () => {
    const inputSchema = JSON.parse('{"oneOf":[{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}]}');
    const body = { model: "claude-sonnet-4", tools: [{ name: "special", input_schema: inputSchema }] };
    prepareClaudeRequest(body, "claude");
    expect(Object.hasOwn(body.tools[0].input_schema.properties, "__proto__")).toBe(true);
    expect(body.tools[0].input_schema.properties["__proto__"]).toEqual({ type: "string" });
    expect(body.tools[0].input_schema.required).toEqual(["__proto__"]);
    expect(Object.prototype).not.toHaveProperty("type");
  });

  it("leaves already compatible input schemas unchanged", () => {
    const inputSchema = { type: "object", properties: { code: { type: "string" } }, required: ["code"] };
    const body = { model: "claude-sonnet-4", tools: [{ name: "js", input_schema: inputSchema }] };
    prepareClaudeRequest(body, "claude");
    expect(body.tools[0].input_schema).toBe(inputSchema);
  });
});
