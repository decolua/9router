/**
 * Regression tests for shorthand string subschemas in Gemini tool declarations.
 *
 * Agent/MCP tool definitions use `{ value: "object" }` as shorthand for
 * `{ value: { type: "object" } }`. Gemini's Schema proto has no union for a
 * bare string, so one occurrence rejects the entire request:
 *
 *   Invalid value at 'tools[0].function_declarations[104].parameters
 *   .properties[4].value' (type.googleapis.com/...Schema), "object"
 *
 * Every sanitizer pass recurses only into `typeof x === "object"`, so string
 * subschemas were invisible to all of them and reached the wire unchanged.
 */

import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity } from "open-sse/translator/formats/gemini.js";

const clean = (schema) => cleanJSONSchemaForAntigravity(structuredClone(schema));

describe("string subschema expansion", () => {
  it("expands a bare string property schema — the reported failure", () => {
    const out = clean({ type: "object", properties: { value: "object" } });
    expect(out.properties.value).toBeTypeOf("object");
    expect(out.properties.value.type).toBe("object");
  });

  it("expands bare string items", () => {
    const out = clean({ type: "array", items: "string" });
    expect(out.items).toEqual({ type: "string" });
  });

  it("expands every scalar type name", () => {
    const out = clean({
      type: "object",
      properties: { a: "string", b: "number", c: "boolean", d: "integer" },
    });
    expect(out.properties.a).toEqual({ type: "string" });
    expect(out.properties.b).toEqual({ type: "number" });
    expect(out.properties.c).toEqual({ type: "boolean" });
    expect(out.properties.d).toEqual({ type: "integer" });
  });

  it("expands string schemas nested inside arrays and objects", () => {
    const out = clean({
      type: "object",
      properties: { rows: { type: "array", items: { type: "object", properties: { cell: "string" } } } },
    });
    expect(out.properties.rows.items.properties.cell).toEqual({ type: "string" });
  });

  it("gives an expanded bare object the placeholder property Gemini requires", () => {
    const out = clean({ type: "object", properties: { value: "object" } });
    expect(out.properties.value.properties).toHaveProperty("reason");
    expect(out.properties.value.required).toEqual(["reason"]);
  });

  it("expands a string schema under $defs", () => {
    const out = clean({ type: "object", $defs: { Thing: "object" }, properties: { a: { type: "string" } } });
    // $defs is stripped as unsupported, but expansion must not throw on the way.
    expect(out.properties.a).toEqual({ type: "string" });
  });

  it("leaves object schemas untouched", () => {
    const input = { type: "object", properties: { a: { type: "string", description: "keep me" } } };
    expect(clean(input).properties.a).toEqual({ type: "string", description: "keep me" });
  });

  it("does not treat a string `type` value as a subschema", () => {
    const out = clean({ type: "object", properties: { a: { type: "string" } } });
    expect(out.type).toBe("object");
    expect(out.properties.a.type).toBe("string");
  });

  it("does not corrupt `required`, which is an array of strings not schemas", () => {
    const out = clean({ type: "object", properties: { a: { type: "string" } }, required: ["a"] });
    expect(out.required).toEqual(["a"]);
  });

  it("does not corrupt `enum`, which is an array of literal strings", () => {
    const out = clean({ type: "object", properties: { mode: { type: "string", enum: ["fast", "slow"] } } });
    expect(out.properties.mode.enum).toEqual(["fast", "slow"]);
  });

  it("still strips additionalProperties: false rather than expanding it", () => {
    const out = clean({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false });
    expect(out).not.toHaveProperty("additionalProperties");
  });

  it("handles the full reported shape without leaving any string subschema", () => {
    const out = clean({
      type: "object",
      properties: {
        one: { type: "string" }, two: { type: "string" }, three: { type: "string" },
        four: { type: "string" }, value: "object",
      },
    });
    const strings = [];
    (function walk(node, path) {
      if (!node || typeof node !== "object") return;
      for (const [key, child] of Object.entries(node.properties || {})) {
        if (typeof child === "string") strings.push(`${path}.${key}`);
        else walk(child, `${path}.${key}`);
      }
      if (node.items) walk(node.items, `${path}.items`);
    })(out, "root");
    expect(strings).toEqual([]);
  });
});
