import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("Gemini Studio bug #5835", () => {
  it("strips thinking suffix from Gemini Studio URL in DefaultExecutor.buildUrl", () => {
    const executor = new DefaultExecutor("gemini");
    expect(executor.buildUrl("gemini-4-hydrogen(xhigh)", true)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:streamGenerateContent?alt=sse"
    );
    expect(executor.buildUrl("gemini-2.5-pro(high)", false)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    );
  });

  it("preserves property names matching schema keywords inside properties map", () => {
    const schema = {
      type: "object",
      properties: {
        message: { type: "string" },
        requestedSchema: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["object"] },
            properties: {
              type: "object",
              additionalProperties: true,
            },
            required: {
              type: "array",
              items: { type: "string" },
            },
            items: {
              type: "object",
              title: "Items",
              default: {},
            },
            "x-custom": { type: "string" },
          },
          required: ["properties", "required"],
        },
      },
      required: ["message", "requestedSchema"],
    };

    const cleaned = cleanJSONSchemaForAntigravity(schema);
    const reqProps = cleaned.properties.requestedSchema.properties;

    expect(reqProps).toHaveProperty("properties");
    expect(reqProps).toHaveProperty("required");
    expect(reqProps).toHaveProperty("items");
    expect(reqProps).toHaveProperty("type");
    expect(reqProps).toHaveProperty("x-custom");
    expect(cleaned.properties.requestedSchema.required).toEqual(["properties", "required"]);
  });
});
