// OpenAI response_format -> Gemini family generationConfig, and the Responses API
// non-streaming body. Regression tests for structured output through the Gemini
// family (generateObject from the Vercel AI SDK failed with "Invalid JSON response").
import { describe, it, expect } from "vitest";
import {
  openaiToGeminiRequest,
  openaiToAntigravityRequest,
} from "../../open-sse/translator/request/openai-to-gemini.js";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../../open-sse/translator/request/openai-responses.js";

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

describe("non-streaming Gemini body -> client format", () => {
  const geminiBody = {
    response: {
      candidates: [{ content: { role: "model", parts: [{ text: "{\"title\":\"x\"}" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
      modelVersion: "gemini-3-flash",
    },
  };

  it("a Responses API client gets a Responses object", () => {
    const out = translateNonStreamingResponse(geminiBody, FORMATS.ANTIGRAVITY, FORMATS.OPENAI_RESPONSES);
    expect(out.object).toBe("response");
    expect(out.status).toBe("completed");
    const message = out.output.find((item) => item.type === "message");
    expect(message.content[0].text).toBe("{\"title\":\"x\"}");
    // the Responses API gives every output item an id; strict clients require it
    expect(message.id).toMatch(/^msg_/);
    expect(message.status).toBe("completed");
  });

  it("a Chat Completions client still gets a chat.completion", () => {
    const out = translateNonStreamingResponse(geminiBody, FORMATS.ANTIGRAVITY, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.content).toBe("{\"title\":\"x\"}");
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

describe("structured output across Responses and Chat Completions", () => {
  it("Responses text.format json_schema becomes Chat response_format and text is not leaked", () => {
    const out = openaiResponsesToOpenAIRequest("m", {
      model: "m",
      input: "extract",
      text: { format: { type: "json_schema", name: "doc", strict: true, schema } },
    }, false);
    expect(out.response_format).toEqual({ type: "json_schema", json_schema: { name: "doc", schema, strict: true } });
    expect(out.text).toBeUndefined();
  });

  it("Responses text.format json_object becomes response_format json_object", () => {
    const out = openaiResponsesToOpenAIRequest("m", { model: "m", input: "x", text: { format: { type: "json_object" } } }, false);
    expect(out.response_format).toEqual({ type: "json_object" });
  });

  it("Chat response_format json_schema becomes Responses text.format", () => {
    const out = openaiToOpenAIResponsesRequest("m", {
      messages,
      response_format: { type: "json_schema", json_schema: { name: "doc", schema, strict: true } },
    }, true);
    expect(out.text.format).toEqual({ type: "json_schema", name: "doc", schema, strict: true });
  });
});
