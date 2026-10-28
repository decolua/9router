import { describe, expect, it } from "vitest";
import { antigravityToOpenAIRequest } from "../../open-sse/translator/request/antigravity-to-openai.js";

function translate(parameters) {
  return antigravityToOpenAIRequest("test-model", {
    request: { tools: [{ functionDeclarations: [{ name: "send_message", parameters }] }] },
  }, false).tools[0].function.parameters;
}

describe("Antigravity Proto3 schema constraints", () => {
  it("converts all six int64 constraint fields within safe integer range, including zero and MAX_SAFE_INTEGER", () => {
    const fields = ["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"];
    for (const field of fields) {
      expect(translate({ [field]: "1" })[field]).toBe(1);
      expect(translate({ [field]: "0" })[field]).toBe(0);
      expect(translate({ [field]: String(Number.MAX_SAFE_INTEGER) })[field]).toBe(Number.MAX_SAFE_INTEGER);
    }
  });

  it("preserves numbers, malformed constraint strings, and integers exceeding safe integer range", () => {
    for (const value of [
      1, 0, "", "abc", "1.5", "-1", "0x10", "Infinity", null,
      "9007199254740992", // Number.MAX_SAFE_INTEGER + 1
      "9223372036854775807", // int64 max
    ]) {
      expect(translate({ minLength: value }).minLength).toBe(value);
    }
  });

  it("normalizes properties, items and anyOf without mutating the input", () => {
    const parameters = { type: "OBJECT", properties: {
      messages: { type: "ARRAY", minItems: "1", items: { anyOf: [
        { type: "STRING", minLength: "1" }, { type: "OBJECT", minProperties: "1" },
      ] } },
      tuple: { type: "ARRAY", items: [
        { type: "STRING", minLength: "2" },
      ] },
    } };
    const before = structuredClone(parameters);
    const output = translate(parameters);
    expect(output.properties.messages.minItems).toBe(1);
    expect(output.properties.messages.items.anyOf).toEqual([
      { type: "string", minLength: 1 }, { type: "object", minProperties: 1 },
    ]);
    expect(output.properties.tuple.items).toEqual([
      { type: "string", minLength: 2 },
    ]);
    expect(parameters).toEqual(before);
  });

  it("preserves unrelated values and existing enumDescriptions removal", () => {
    expect(translate({ type: "INTEGER", minimum: "1", maximum: 10,
      default: "1", enum: ["1"], example: "1", enumDescriptions: ["one"],
    })).toEqual({ type: "integer", minimum: "1", maximum: 10,
      default: "1", enum: ["1"], example: "1",
    });
  });

  it("does not reinterpret keyword-like property names", () => {
    expect(translate({ type: "OBJECT", properties: {
      minLength: { type: "STRING", minLength: "2" },
    } })).toEqual({ type: "object", properties: {
      minLength: { type: "string", minLength: 2 },
    } });
  });
});
