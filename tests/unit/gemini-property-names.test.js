import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity as clean } from "../../open-sse/translator/formats/gemini.js";

describe("Gemini schema traversal preserves parameter names", () => {
  it.each([
    "title",
    "default",
    "x-custom",
    "const",
    "enum",
    "type",
    "properties",
    "items",
    "required",
    "anyOf",
    "allOf",
    "prefixItems",
    "errorMessage",
  ])("preserves the required parameter %s", (name) => {
    const result = clean({
      type: "object",
      properties: {
        [name]: { type: "string", title: "annotation", "x-note": "annotation" },
      },
      required: [name],
    });
    expect(Object.keys(result.properties)).toEqual([name]);
    expect(result.required).toEqual([name]);
    expect(result.properties[name]).toEqual({ type: "string" });
  });

  it("preserves nested names through arrays and union flattening", () => {
    const result = clean({
      type: "object",
      properties: {
        records: {
          type: "array",
          items: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: {
                  title: { type: ["string", "null"], minLength: 1 },
                },
                required: ["title"],
              },
            ],
          },
        },
      },
    });
    expect(result.properties.records.items).toEqual({
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    });
  });

  it("converts const and enum on schemas without interpreting field maps as schemas", () => {
    const result = clean({
      type: "object",
      properties: {
        const: { const: "fixed" },
        enum: { enum: [1, 2] },
        title: { type: "string" },
      },
      required: ["const", "enum", "title"],
    });
    expect(result.properties).toEqual({
      const: { type: "string", enum: ["fixed"] },
      enum: { type: "string", enum: ["1", "2"] },
      title: { type: "string" },
    });
    expect(result.required).toEqual(["const", "enum", "title"]);
  });

  it("still strips annotations and unsupported schema nodes", () => {
    const result = clean({
      type: "object",
      title: "annotation",
      additionalProperties: true,
      $defs: { item: { type: "string" } },
      properties: {
        title: {
          type: "string",
          default: "ignored",
          examples: ["ignored"],
          format: "uri",
        },
      },
      required: ["title", "absent"],
    });
    expect(result).toEqual({
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    });
  });

  it("retains tuple, allOf and empty-schema conversion behavior", () => {
    const result = clean({
      allOf: [
        { properties: { title: { type: "string" } }, required: ["title"] },
      ],
      properties: {
        entries: { type: "array", prefixItems: [{ type: "integer" }] },
        empty: {},
      },
    });
    expect(result.type).toBe("object");
    expect(result.properties.entries).toEqual({
      type: "array",
      items: { type: "integer" },
    });
    expect(result.properties.empty.required).toEqual(["reason"]);
    expect(result.properties.title).toEqual({ type: "string" });
    expect(result.required).toEqual(["title"]);
  });
});
