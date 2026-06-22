import { describe, expect, it } from "vitest";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

const responsesBody = () => ({
  model: "glm-5.2",
  input: "hello",
  text: { format: { type: "text" } },
  client_metadata: { client: "codex-cli" },
  max_output_tokens: 32,
});

describe("Responses API cleanup", () => {
  it("does not leak Responses-only root fields from the direct converter", () => {
    const converted = convertResponsesApiFormat(responsesBody());

    expect(converted.messages).toHaveLength(1);
    expect(converted).not.toHaveProperty("input");
    expect(converted).not.toHaveProperty("text");
    expect(converted).not.toHaveProperty("client_metadata");
  });

  it("does not leak Responses-only root fields through the registered translator", () => {
    const converted = openaiResponsesToOpenAIRequest("glm-5.2", responsesBody(), false, null);

    expect(converted.messages).toHaveLength(1);
    expect(converted).not.toHaveProperty("input");
    expect(converted).not.toHaveProperty("text");
    expect(converted).not.toHaveProperty("client_metadata");
    expect(converted.max_tokens).toBe(32);
    expect(converted).not.toHaveProperty("max_output_tokens");
  });
});
