import { describe, expect, it } from "vitest";

import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

// Gemini's Schema proto (google.cloud.aiplatform.master.Schema) accepts only a
// Schema *object* at every property position. Real MCP tool servers emit a bare
// type name where a Schema belongs, and one occurrence rejects the whole
// request — every account fails identically (#2877, #2489):
//
//   400 INVALID_ARGUMENT
//   Invalid value at 'request.tools[0].function_declarations[71]
//     .parameters.properties[9].value'
//     (type.googleapis.com/google.cloud.aiplatform.master.Schema), "object"
//
// The trailing `"object"` in that message is the *rejected value*, not the
// expected type.
//
// The second shape is a tuple `items` array, which the proto rejects as:
//
//   Unknown name "items" at '…parameters.properties[0].value':
//     Proto field is not repeating, cannot start list.

// Mirror of the shapes the API rejects, applied recursively. The cleaned schema
// must contain none of them or the request is deterministically malformed.
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

  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(node[key])) {
      node[key].forEach((child, index) => findInvalidSchemaShapes(child, `${path}.${key}[${index}]`, found));
    }
  }

  return found;
}

describe("cleanJSONSchemaForAntigravity — free-form property values (#2877, #2489)", () => {
  it("coerces a bare type name standing in for a property schema", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        cloudId: { type: "string" },
        // The offending shape: the type name where a Schema belongs.
        value: "object",
      },
      required: ["cloudId", "value"],
    });

    expect(findInvalidSchemaShapes(cleaned)).toEqual([]);
    expect(cleaned.properties.value).toMatchObject({ type: "object" });
    // `cleanupRequired` must not drop the coerced property.
    expect(cleaned.required).toEqual(["cloudId", "value"]);
  });

  it("coerces every known JSON Schema type name", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        a: "string",
        b: "number",
        c: "integer",
        d: "boolean",
        e: "array",
        f: "object",
      },
    });

    expect(findInvalidSchemaShapes(cleaned)).toEqual([]);
    for (const [name, type] of Object.entries({
      a: "string", b: "number", c: "integer", d: "boolean", e: "array", f: "object",
    })) {
      expect(cleaned.properties[name]).toMatchObject({ type });
    }
  });

  it("degrades an unrecognised type name to a string instead of rejecting the tool", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { odd: "definitely-not-a-type" },
    });

    expect(findInvalidSchemaShapes(cleaned)).toEqual([]);
    expect(cleaned.properties.odd).toEqual({ type: "string" });
  });

  it("coerces free-form values nested inside objects and array items", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        root: "object",
        list: {
          type: "array",
          items: {
            type: "object",
            properties: { deep: "object" },
          },
        },
      },
    });

    expect(findInvalidSchemaShapes(cleaned)).toEqual([]);
  });

  it("leaves a property literally named `properties` alone", () => {
    // Property names are arbitrary data — a tool may declare one called
    // "properties", and it must not be read as the schema keyword.
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        properties: { type: "object", properties: { inner: "string" } },
      },
    });

    expect(findInvalidSchemaShapes(cleaned)).toEqual([]);
    expect(cleaned.properties.properties.properties.inner).toEqual({ type: "string" });
  });
});

describe("cleanJSONSchemaForAntigravity — tuple items", () => {
  it("collapses an `items` array to a single schema", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        range: { type: "array", items: [{ type: "number" }, { type: "integer" }] },
      },
      required: ["range"],
    });

    expect(findInvalidSchemaShapes(cleaned)).toEqual([]);
    expect(Array.isArray(cleaned.properties.range.items)).toBe(false);
    expect(cleaned.properties.range.items).toBeTypeOf("object");
  });

  it("prefers the most informative member of a heterogeneous tuple", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        mixed: {
          type: "array",
          // object > array > scalar, mirroring selectBest()
          items: ["string", { type: "array", items: { type: "string" } }, { type: "object", properties: { k: { type: "string" } } }],
        },
      },
    });

    expect(findInvalidSchemaShapes(cleaned)).toEqual([]);
    expect(cleaned.properties.mixed.items).toMatchObject({ type: "object" });
  });

  it("drops an items array that carries no usable schema", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { junk: { type: "array", items: [null, "not-a-schema"] } },
    });

    expect(findInvalidSchemaShapes(cleaned)).toEqual([]);
    // ensureArrayItems() then supplies the permissive placeholder.
    expect(cleaned.properties.junk.items).toMatchObject({ type: "string" });
  });
});

describe("cleanJSONSchemaForAntigravity — already-compatible schemas unchanged", () => {
  it("keeps ordinary schemas byte-identical", () => {
    const schema = {
      type: "object",
      properties: {
        city: { type: "string", description: "The city name" },
        options: {
          type: "object",
          properties: { limit: { type: "integer" } },
          required: ["limit"],
        },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["city"],
    };
    const snapshot = structuredClone(schema);

    const cleaned = cleanJSONSchemaForAntigravity(schema);

    expect(cleaned).toEqual(snapshot);
  });

  it("is idempotent on a repaired schema", () => {
    const broken = {
      type: "object",
      properties: {
        value: "object",
        range: { type: "array", items: [{ type: "number" }, { type: "number" }] },
      },
    };

    const once = cleanJSONSchemaForAntigravity(structuredClone(broken));
    const twice = cleanJSONSchemaForAntigravity(structuredClone(once));

    expect(twice).toEqual(once);
  });
});
