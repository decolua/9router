/**
 * Regression tests for schema maps being mistaken for schemas.
 *
 * A tool may legitimately declare a property NAMED "properties", "items",
 * "definitions", etc. Every sanitizer pass used to recurse with a blind
 *
 *     for (const v of Object.values(obj)) if (v && typeof v === "object") walk(v);
 *
 * which cannot tell the schema MAP `{properties: {foo: {...}}}` from a schema
 * NODE. For a tool like mcp__pascal__set_zone — whose input has a property
 * called "properties" — `ensureObjectType` stamped `type: "object"` directly
 * into the map, producing
 *
 *     properties: { levelId: {...}, properties: {...}, type: "object" }
 *                                                      ^^^^^^^^^^^^^^
 * a bare string where Gemini's proto demands a Schema, and Google rejected the
 * whole request with INVALID_ARGUMENT.
 */
import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

const clean = (s) => cleanJSONSchemaForAntigravity(structuredClone(s));

describe("schema maps are not treated as schemas", () => {
  it("does not inject type into a properties map for a property named 'properties'", () => {
    const out = clean({
      type: "object",
      properties: {
        levelId: { type: "string" },
        properties: { type: "object", propertyNames: { type: "string" }, additionalProperties: {} },
      },
      required: ["levelId"],
    });

    // The map itself must never gain a `type` key.
    expect(out.properties.type).toBeUndefined();
    // Every entry in the map must still be a schema object, never a string.
    for (const v of Object.values(out.properties)) {
      expect(typeof v).toBe("object");
    }
  });

  it("keeps a property named 'properties' a valid object schema", () => {
    const out = clean({
      type: "object",
      properties: {
        properties: { type: "object", propertyNames: { type: "string" }, additionalProperties: {} },
      },
    });
    const inner = out.properties.properties;
    expect(inner.type).toBe("object");
    // Emptied object schemas get the placeholder, not a stray string.
    expect(typeof inner.properties).toBe("object");
    expect(inner.properties.reason).toBeDefined();
  });

  it("handles a property named 'items' without corrupting it", () => {
    const out = clean({
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
      },
    });
    expect(out.properties.items.type).toBe("array");
    expect(out.properties.items.items).toEqual({ type: "string" });
    expect(typeof out.properties.type).toBe("undefined");
  });

  it("does not add items to a map holding a property named 'type'", () => {
    const out = clean({
      type: "object",
      properties: {
        type: { type: "string", enum: ["a", "b"] },
      },
    });
    expect(out.properties.type.type).toBe("string");
  });

  it("produces zero non-object subschemas for the real set_zone tool shape", () => {
    const out = clean({
      type: "object",
      properties: {
        levelId: { type: "string" },
        polygon: { type: "array", items: { type: "array", items: { type: "number" } } },
        label: { type: "string" },
        properties: { type: "object", propertyNames: { type: "string" }, additionalProperties: {} },
      },
      required: ["levelId", "polygon", "label"],
      additionalProperties: false,
    });

    const bad = [];
    const MAPS = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"];
    const walk = (n, p) => {
      if (!n || typeof n !== "object") return;
      for (const m of MAPS) {
        const sub = n[m];
        if (sub && typeof sub === "object") {
          for (const [k, v] of Object.entries(sub)) {
            if (!v || typeof v !== "object") bad.push(`${p}.${m}.${k}=${JSON.stringify(v)}`);
            else walk(v, `${p}.${m}.${k}`);
          }
        }
      }
      for (const [k, v] of Object.entries(n)) {
        if (MAPS.includes(k)) continue;
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v, `${p}.${k}`);
      }
    };
    walk(out, "root");
    expect(bad).toEqual([]);
  });

  it("still recurses into nested schemas (fix must not stop traversal)", () => {
    const out = clean({
      type: "object",
      properties: {
        outer: {
          properties: {
            inner: { type: "array" },
          },
        },
      },
    });
    // ensureObjectType still infers the missing type on a real nested schema...
    expect(out.properties.outer.type).toBe("object");
    // ...and ensureArrayItems still fills missing items.
    expect(out.properties.outer.properties.inner.items).toBeDefined();
  });
});
