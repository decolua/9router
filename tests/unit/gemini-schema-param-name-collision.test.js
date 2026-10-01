import { describe, expect, it } from "vitest";

import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

// #4306: OpenAI→Gemini tool schema conversion failed when a tool parameter was
// literally named "properties". Gemini answered 400 "Invalid value at
// ...parameters.properties[N].value ... \"object\"", because the cleaner walked
// the `properties` MAP as if it were a schema node and stamped `type:"object"`
// onto it. Real MCP servers hit this: Notion (notion-create-pages,
// notion-update-page) and Atlassian (getJiraIssue).

const clean = (s) => cleanJSONSchemaForAntigravity(structuredClone(s));

describe("a parameter named 'properties' survives intact (#4306)", () => {
  it("is the exact repro from the issue", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string" },
        properties: { type: "array", items: { type: "string" } },
      },
    };
    // Before the fix the output gained a stray top-level `"type":"object"` and
    // the inner parameter was mangled.
    expect(clean(schema)).toEqual(schema);
  });

  it("does not stamp type:object onto the properties map", () => {
    const out = clean({
      type: "object",
      properties: { properties: { type: "string" } },
    });
    expect(out.type).toBe("object");
    // The map's only key is the parameter name; the map itself is not a schema.
    expect(Object.keys(out.properties)).toEqual(["properties"]);
    expect(out.properties.properties).toEqual({ type: "string" });
  });

  it("handles a Notion-style nested properties object", () => {
    const schema = {
      type: "object",
      properties: {
        properties: {
          type: "object",
          properties: { title: { type: "string" } },
        },
      },
    };
    expect(clean(schema)).toEqual(schema);
  });
});

describe("parameters named after JSON Schema keywords are not eaten", () => {
  // UNSUPPORTED_SCHEMA_CONSTRAINTS contains ordinary words — "title",
  // "optional", "default" — so stripping by key name deleted real parameters.
  it.each(["title", "optional", "default", "examples", "not", "contains", "if", "then", "else"])(
    "keeps a parameter named '%s'",
    (name) => {
      const schema = { type: "object", properties: { [name]: { type: "string" } } };
      expect(clean(schema)).toEqual(schema);
    }
  );

  it("still strips the keyword when it IS a keyword, i.e. on the node itself", () => {
    // `title` on a schema node is an annotation Gemini rejects and must go.
    const out = clean({
      type: "object",
      properties: { n: { type: "string", minLength: 2, title: "ignored" } },
    });
    expect(out.properties.n).toEqual({ type: "string" });
  });
});

describe("the cleaner's own transforms still fire at every level", () => {
  it("still infers type:object for a nested object schema", () => {
    const out = clean({ properties: { nested: { properties: { x: { type: "string" } } } } });
    expect(out.properties.nested.type).toBe("object");
  });

  it("still fills items on an array with none", () => {
    const out = clean({ type: "object", properties: { tags: { type: "array" } } });
    expect(out.properties.tags.items).toEqual({ type: "string" });
  });

  it("still converts const to enum deep inside", () => {
    const out = clean({
      type: "object",
      properties: { n: { properties: { k: { const: "fixed" } } } },
    });
    expect(out.properties.n.properties.k.enum).toEqual(["fixed"]);
    expect(out.properties.n.properties.k.const).toBeUndefined();
  });

  it("still flattens anyOf deep inside", () => {
    const out = clean({
      type: "object",
      properties: { v: { anyOf: [{ type: "string" }, { type: "null" }] } },
    });
    expect(out.properties.v.type).toBe("string");
    expect(out.properties.v.anyOf).toBeUndefined();
  });

  it("still adds the placeholder for an empty object schema", () => {
    const out = clean({ type: "object", properties: {} });
    expect(out.properties.reason).toBeTruthy();
  });

  it("does not loop forever on a self-referential shape", () => {
    // The walker must terminate even when a map is empty or a node is bare.
    expect(() => clean({ type: "object", properties: {} })).not.toThrow();
    expect(() => clean({ type: "object", properties: { a: {} } })).not.toThrow();
  });
});
