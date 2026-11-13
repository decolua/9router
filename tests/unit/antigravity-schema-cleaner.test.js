import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("cleanJSONSchemaForAntigravity", () => {
  it("preserves schema-keyword names used as object properties", () => {
    const schema = {
      type: "object",
      properties: {
        page_id: { type: "string" },
        properties: {
          type: "object",
          description: "Page property values",
          additionalProperties: true,
        },
        title: { type: "string" },
      },
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(cleaned.properties).toEqual({
      page_id: { type: "string" },
      properties: {
        type: "object",
        description: "Page property values",
        properties: {
          reason: {
            type: "string",
            description: "Brief explanation of why you are calling this tool",
          },
        },
        required: ["reason"],
      },
      title: { type: "string" },
    });
  });
});
