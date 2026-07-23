import { describe, expect, it } from "vitest";

import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../../open-sse/translator/request/openai-responses.js";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
  },
  required: ["title"],
};

const chatBody = (responseFormat, extra = {}) => ({
  messages: [{ role: "user", content: "Return a title." }],
  response_format: responseFormat,
  ...extra,
});

const responsesBody = (format, extra = {}) => ({
  input: [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Return a title." }],
  }],
  text: { format },
  ...extra,
});

describe("OpenAI structured-output request translation", () => {
  it("maps strict Chat Completions JSON Schema to Responses text.format", () => {
    const body = chatBody({
      type: "json_schema",
      json_schema: {
        name: "title_result",
        description: "A generated title",
        schema,
        strict: true,
      },
    });

    const result = openaiToOpenAIResponsesRequest("gpt-5.6", body, true);

    expect(result.text).toEqual({
      format: {
        type: "json_schema",
        name: "title_result",
        description: "A generated title",
        schema,
        strict: true,
      },
    });
    expect(result).not.toHaveProperty("response_format");
  });

  it("maps Responses JSON Schema to nested Chat Completions response_format", () => {
    const body = responsesBody({
      type: "json_schema",
      name: "title_result",
      schema,
      strict: true,
    });

    const result = openaiResponsesToOpenAIRequest("gpt-5.6", body, true);

    expect(result.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "title_result",
        schema,
        strict: true,
      },
    });
    expect(result).not.toHaveProperty("text");
  });

  it("preserves strict false and an omitted optional description", () => {
    const result = openaiToOpenAIResponsesRequest(
      "gpt-5.6",
      chatBody({
        type: "json_schema",
        json_schema: {
          name: "non_strict_result",
          schema,
          strict: false,
        },
      }),
      true,
    );

    expect(result.text.format).toEqual({
      type: "json_schema",
      name: "non_strict_result",
      schema,
      strict: false,
    });
    expect(result.text.format).not.toHaveProperty("description");
  });

  it.each([
    ["Chat to Responses", chatBody({ type: "json_object" }), "text", { format: { type: "json_object" } }],
    ["Responses to Chat", responsesBody({ type: "json_object" }), "response_format", { type: "json_object" }],
  ])("maps JSON mode from %s", (_label, body, key, expected) => {
    const result = key === "text"
      ? openaiToOpenAIResponsesRequest("gpt-5.6", body, true)
      : openaiResponsesToOpenAIRequest("gpt-5.6", body, true);

    expect(result[key]).toEqual(expected);
  });

  it("prefers native Responses text.format and preserves other text options", () => {
    const nativeFormat = {
      type: "json_schema",
      name: "native_result",
      schema: { type: "string" },
      strict: true,
    };
    const body = chatBody(
      {
        type: "json_schema",
        json_schema: { name: "chat_result", schema, strict: true },
      },
      {
        text: {
          verbosity: "low",
          format: nativeFormat,
        },
      },
    );

    const result = openaiToOpenAIResponsesRequest("gpt-5.6", body, true);

    expect(result.text).toEqual({
      verbosity: "low",
      format: nativeFormat,
    });
    expect(result).not.toHaveProperty("response_format");
  });

  it("prefers native Chat response_format over Responses text.format", () => {
    const nativeResponseFormat = {
      type: "json_schema",
      json_schema: {
        name: "native_chat_result",
        schema: { type: "number" },
        strict: true,
      },
    };
    const body = responsesBody(
      {
        type: "json_schema",
        name: "responses_result",
        schema,
        strict: true,
      },
      { response_format: nativeResponseFormat },
    );

    const result = openaiResponsesToOpenAIRequest("gpt-5.6", body, true);

    expect(result.response_format).toEqual(nativeResponseFormat);
    expect(result).not.toHaveProperty("text");
  });

  it("does not invent semantics for unknown format types", () => {
    const chatResult = openaiToOpenAIResponsesRequest(
      "gpt-5.6",
      chatBody({ type: "xml" }),
      true,
    );
    const responsesResult = openaiResponsesToOpenAIRequest(
      "gpt-5.6",
      responsesBody({ type: "xml" }),
      true,
    );

    expect(chatResult).not.toHaveProperty("text");
    expect(chatResult).not.toHaveProperty("response_format");
    expect(responsesResult).not.toHaveProperty("response_format");
    expect(responsesResult).not.toHaveProperty("text");
  });

  it("maps response_format on an input-native mixed request without mutating it", () => {
    const body = {
      ...responsesBody(undefined),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "mixed_result",
          schema,
          strict: true,
        },
      },
    };
    delete body.text;
    const before = structuredClone(body);

    const result = openaiToOpenAIResponsesRequest("gpt-5.6", body, true);

    expect(result.text.format).toEqual({
      type: "json_schema",
      name: "mixed_result",
      schema,
      strict: true,
    });
    expect(result).not.toHaveProperty("response_format");
    expect(body).toEqual(before);
  });

  it("does not mutate either source body", () => {
    const chat = chatBody({
      type: "json_schema",
      json_schema: { name: "chat_result", schema, strict: true },
    });
    const responses = responsesBody({
      type: "json_schema",
      name: "responses_result",
      schema,
      strict: true,
    });
    const chatBefore = structuredClone(chat);
    const responsesBefore = structuredClone(responses);

    openaiToOpenAIResponsesRequest("gpt-5.6", chat, true);
    openaiResponsesToOpenAIRequest("gpt-5.6", responses, true);

    expect(chat).toEqual(chatBefore);
    expect(responses).toEqual(responsesBefore);
  });
});
