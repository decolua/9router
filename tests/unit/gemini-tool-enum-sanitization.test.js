import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("cleanJSONSchemaForAntigravity enum sanitization", () => {
  it("removes empty string values from enum arrays", () => {
    const schema = {
      type: "object",
      properties: {
        calendarId: {
          type: "string",
          enum: ["", "primary", "secondary"]
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.calendarId.enum).toEqual(["primary", "secondary"]);
    expect(result.properties.calendarId.type).toBe("string");
  });

  it("deletes enum property if all enum values are empty strings or null/undefined", () => {
    const schema = {
      type: "object",
      properties: {
        calendarId: {
          type: "string",
          enum: ["", null, undefined]
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.calendarId).not.toHaveProperty("enum");
    expect(result.properties.calendarId.type).toBe("string");
  });

  it("deletes empty enum array enum: []", () => {
    const schema = {
      type: "object",
      properties: {
        calendarId: {
          type: "string",
          enum: []
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.calendarId).not.toHaveProperty("enum");
    expect(result.properties.calendarId.type).toBe("string");
  });

  it("converts const to enum only when const is non-empty", () => {
    const schemaEmptyConst = {
      type: "object",
      properties: {
        calendarId: {
          type: "string",
          const: ""
        }
      }
    };
    const resultEmpty = cleanJSONSchemaForAntigravity(structuredClone(schemaEmptyConst));
    expect(resultEmpty.properties.calendarId).not.toHaveProperty("const");
    expect(resultEmpty.properties.calendarId).not.toHaveProperty("enum");

    const schemaValidConst = {
      type: "object",
      properties: {
        status: {
          type: "string",
          const: "active"
        }
      }
    };
    const resultValid = cleanJSONSchemaForAntigravity(structuredClone(schemaValidConst));
    expect(resultValid.properties.status).not.toHaveProperty("const");
    expect(resultValid.properties.status.enum).toEqual(["active"]);
  });

  it("sanitizes enums inside nested objects and array items", () => {
    const schema = {
      type: "object",
      properties: {
        filters: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              enum: ["", "all", "user"]
            }
          }
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: [""]
              }
            }
          }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.filters.properties.scope.enum).toEqual(["all", "user"]);
    expect(result.properties.items.items.properties.category).not.toHaveProperty("enum");
  });

  it("deletes required array when object has no properties", () => {
    const schema = {
      type: "object",
      required: ["someField"]
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    // Since properties was empty, placeholder reason was added, so required should only contain reason
    expect(result.required).toEqual(["reason"]);
  });
});
