import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity, UNSUPPORTED_SCHEMA_CONSTRAINTS } from "../../open-sse/translator/formats/gemini.js";

/**
 * Guards fix for issue #2309:
 * Gemini API rejects tool schemas that contain "multipleOf" — it must be
 * stripped from function declaration parameters before dispatch.
 */
describe("UNSUPPORTED_SCHEMA_CONSTRAINTS includes multipleOf", () => {
  it("lists multipleOf as an unsupported keyword", () => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("multipleOf");
  });
});

describe("cleanJSONSchemaForAntigravity strips multipleOf", () => {
  it("removes multipleOf from a top-level number property", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "integer", multipleOf: 5 }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.count.multipleOf).toBeUndefined();
    expect(result.properties.count.type).toBe("integer");
  });

  it("removes multipleOf from nested items schemas", () => {
    const schema = {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: { type: "number", multipleOf: 0.1 }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.values.items.multipleOf).toBeUndefined();
  });

  it("does not strip other numeric keywords like minimum/maximum", () => {
    const schema = {
      type: "object",
      properties: {
        age: { type: "integer", minimum: 0, maximum: 150, multipleOf: 1 }
      }
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.properties.age.multipleOf).toBeUndefined();
    expect(result.properties.age.minimum).toBe(0);
    expect(result.properties.age.maximum).toBe(150);
  });
});
