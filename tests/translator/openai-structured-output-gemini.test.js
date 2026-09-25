// OpenAI response_format -> Gemini family generationConfig, and the Responses API
// non-streaming body. Regression tests for structured output through the Gemini
// family (generateObject from the Vercel AI SDK failed with "Invalid JSON response").
import { describe, it, expect } from "vitest";
import {
  openaiToGeminiRequest,
  openaiToAntigravityRequest,
} from "../../open-sse/translator/request/openai-to-gemini.js";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";
import { chatCompletionToResponses } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

const schema = {
  type: "object",
  properties: { title: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
  required: ["title"],
  additionalProperties: false,
};
const messages = [{ role: "user", content: "Extract the title" }];

describe("OpenAI response_format -> Gemini generationConfig", () => {
  it("json_schema sets responseMimeType and a cleaned responseSchema", () => {
    const out = openaiToGeminiRequest("gemini-3-flash", {
      messages,
      response_format: { type: "json_schema", json_schema: { name: "x", strict: true, schema } },
    }, false);
    expect(out.generationConfig.responseMimeType).toBe("application/json");
    expect(out.generationConfig.responseSchema.type).toBe("object");
    expect(out.generationConfig.responseSchema.properties.title.type).toBe("string");
    expect(out.generationConfig.responseSchema.required).toEqual(["title"]);
    // unsupported keyword removed, caller's schema untouched
    expect(out.generationConfig.responseSchema.additionalProperties).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
  });

  it("json_object sets only responseMimeType", () => {
    const out = openaiToGeminiRequest("gemini-3-flash", { messages, response_format: { type: "json_object" } }, false);
    expect(out.generationConfig.responseMimeType).toBe("application/json");
    expect(out.generationConfig.responseSchema).toBeUndefined();
  });

  it("text or no response_format leaves generationConfig without a MIME type", () => {
    const out = openaiToGeminiRequest("gemini-3-flash", { messages, response_format: { type: "text" } }, false);
    expect(out.generationConfig.responseMimeType).toBeUndefined();
  });

  it("the Antigravity envelope carries the structured output config", () => {
    const out = openaiToAntigravityRequest("gemini-3-flash", {
      messages,
      response_format: { type: "json_schema", json_schema: { name: "x", schema } },
    }, false, { projectId: "p", email: "a@b.c" });
    expect(out.request.generationConfig.responseMimeType).toBe("application/json");
    expect(out.request.generationConfig.responseSchema.properties.title.type).toBe("string");
  });
});

describe("cleanJSONSchemaForAntigravity toolPlaceholders", () => {
  it("adds the reason placeholder to empty objects by default (tool schemas)", () => {
    const out = cleanJSONSchemaForAntigravity({ type: "object", properties: {} });
    expect(Object.keys(out.properties)).toEqual(["reason"]);
  });

  it("does not add it for response schemas", () => {
    const out = cleanJSONSchemaForAntigravity({ type: "object", properties: {} }, { toolPlaceholders: false });
    expect(out.properties).toEqual({});
  });
});

describe("chat.completion -> Responses object", () => {
  it("maps a non-streaming chat completion to the Responses shape", () => {
    const out = chatCompletionToResponses({
      id: "chatcmpl-abc",
      object: "chat.completion",
      created: 1,
      model: "gemini-3-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "{\"title\":\"x\"}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    });
    expect(out.object).toBe("response");
    expect(out.status).toBe("completed");
    expect(out.output[0].content[0].text).toBe("{\"title\":\"x\"}");
    expect(out.usage).toEqual({ input_tokens: 3, output_tokens: 4, total_tokens: 7 });
  });
});

describe("schema cleaning keeps fields named like keywords", () => {
  it("keeps properties called title, format and default, and still strips the keywords", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      title: "Doc",
      properties: {
        title: { type: "string", title: "The title", maxLength: 80 },
        format: { type: "string", enum: ["a", "b"], default: "a" },
        default: { type: "boolean" },
      },
      required: ["title", "format"],
    });
    expect(Object.keys(out.properties).sort()).toEqual(["default", "format", "title"]);
    expect(out.title).toBeUndefined();
    expect(out.properties.title.title).toBeUndefined();
    expect(out.properties.title.maxLength).toBeUndefined();
    expect(out.properties.format.default).toBeUndefined();
    expect(out.required).toEqual(["title", "format"]);
  });
});
