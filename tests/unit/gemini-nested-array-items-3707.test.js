import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("cleanJSONSchemaForAntigravity handles nested and empty array items (#3707)", () => {
  it("ensures 2D array with empty items gets a valid type", () => {
    const schema = {
      type: "object",
      properties: {
        query: {
          type: "object",
          properties: {
            where: {
              type: "array",
              items: {
                type: "array",
                items: {}
              }
            }
          }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.query.properties.where.items.items).toHaveProperty("type");
    expect(result.properties.query.properties.where.items.items.type).toBe("string");
  });

  it("ensures 2D array with missing inner items gets a valid type", () => {
    const schema = {
      type: "object",
      properties: {
        query: {
          type: "object",
          properties: {
            where: {
              type: "array",
              items: {
                type: "array"
              }
            }
          }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.query.properties.where.items.items).toHaveProperty("type");
    expect(result.properties.query.properties.where.items.items.type).toBe("string");
  });

  it("ensures array with tuple items gets converted to a single schema object with type", () => {
    const schema = {
      type: "object",
      properties: {
        query: {
          type: "object",
          properties: {
            where: {
              type: "array",
              items: [
                { type: "string" },
                { type: "string" }
              ]
            }
          }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(Array.isArray(result.properties.query.properties.where.items)).toBe(false);
    expect(result.properties.query.properties.where.items).toHaveProperty("type");
  });

  it("handles array items stripped by unsupported keywords", () => {
    const schema = {
      type: "object",
      properties: {
        query: {
          type: "object",
          properties: {
            where: {
              type: "array",
              items: {
                type: "array",
                items: {
                  title: "Condition",
                  default: []
                }
              }
            }
          }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.query.properties.where.items.items).toHaveProperty("type");
    expect(result.properties.query.properties.where.items.items.type).toBe("string");
  });

  it("handles 3D nested arrays with empty inner items", () => {
    const schema = {
      type: "object",
      properties: {
        matrix: {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "array",
              items: {}
            }
          }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.matrix.items.items.items).toHaveProperty("type");
    expect(result.properties.matrix.items.items.items.type).toBe("string");
  });

  it("infers array type when items is present without explicit type", () => {
    const schema = {
      type: "object",
      properties: {
        tags: {
          items: {
            type: "string"
          }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.tags.type).toBe("array");
    expect(result.properties.tags.items.type).toBe("string");
  });

  it("infers object type for array items when properties is present without explicit type", () => {
    const schema = {
      type: "object",
      properties: {
        records: {
          type: "array",
          items: {
            properties: {
              id: { type: "string" }
            }
          }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.records.type).toBe("array");
    expect(result.properties.records.items.type).toBe("object");
    expect(result.properties.records.items.properties.id.type).toBe("string");
  });
});
