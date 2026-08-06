import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("cleanJSONSchemaForAntigravity schema-node walking (#2884)", () => {
  it("does not inject type=object into a property name-map when a param is named 'properties'", () => {
    const schema = {
      type: "object",
      properties: {
        // A parameter literally named "properties" — the name-map value is a schema node
        properties: { type: "object", properties: { title: { type: "string" } } },
        ok: { type: "string" },
      },
    };
    const out = cleanJSONSchemaForAntigravity(structuredClone(schema));
    // The name-map key "properties" (param name) must survive untouched
    expect(out.properties.properties).toEqual({ type: "object", properties: { title: { type: "string" } } });
    expect(out.properties.ok).toEqual({ type: "string" });
  });

  it("does not delete a parameter named 'title' or 'format'", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
        format: { type: "string" },
        body: { type: "string" },
      },
    };
    const out = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(out.properties.title).toEqual({ type: "string" });
    expect(out.properties.format).toEqual({ type: "string" });
    expect(out.properties.body).toEqual({ type: "string" });
  });

  it("still strips unsupported keywords from real schema nodes", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, format: "email", default: "x" },
      },
      required: ["name"],
    };
    const out = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(out.properties.name.minLength).toBeUndefined();
    expect(out.properties.name.format).toBeUndefined();
    expect(out.properties.name.default).toBeUndefined();
    expect(out.properties.name.type).toBe("string");
    expect(out.required).toEqual(["name"]);
  });

  it("still infers type=object for nested schema nodes that have properties", () => {
    const schema = {
      type: "object",
      properties: {
        nested: { properties: { x: { type: "string" } } },
      },
    };
    const out = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(out.properties.nested.type).toBe("object");
    expect(out.properties.nested.properties.x).toEqual({ type: "string" });
  });
});
