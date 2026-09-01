import { describe, expect, it } from "vitest";
import { normalizeToolSchemasForProvider } from "../../open-sse/utils/toolSchemaCompatibility.js";

const tools = [{
  type: "function",
  function: {
    name: "find_files",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", pattern: "^[a-z]+$" },
        nested: {
          type: "object",
          properties: { value: { type: "string", pattern: "[" } },
        },
      },
      required: ["pattern"],
    },
  },
}];

describe("normalizeToolSchemasForProvider", () => {
  it("removes regex constraints for OpenRouter while preserving function schemas", () => {
    const normalized = normalizeToolSchemasForProvider("openrouter", tools);
    const parameters = normalized[0].function.parameters;

    expect(parameters.required).toEqual(["pattern"]);
    expect(parameters.properties.pattern).toEqual({ type: "string", pattern: "^[a-z]+$" });
    expect(parameters.properties.nested.properties.value).toEqual({ type: "string" });
    expect(tools[0].function.parameters.properties.pattern.pattern).toBe("^[a-z]+$");
  });

  it("does not modify schemas for other providers", () => {
    expect(normalizeToolSchemasForProvider("groq", tools)).toBe(tools);
  });
});