import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("OpenAI-compatible request sanitization", () => {
  it("strips Codex-only client_metadata from chat-compatible providers", () => {
    const executor = new DefaultExecutor("openai-compatible-chat-test");
    const body = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      client_metadata: { source: "codex" },
    };

    const transformed = executor.transformRequest("deepseek-v4-pro", body);

    expect(transformed).not.toHaveProperty("client_metadata");
    expect(transformed.messages).toEqual(body.messages);
  });

  it("keeps client_metadata for responses-compatible providers", () => {
    const executor = new DefaultExecutor("openai-compatible-responses-test");
    const body = {
      model: "test-model",
      input: "hello",
      client_metadata: { source: "codex" },
    };

    const transformed = executor.transformRequest("test-model", body);

    expect(transformed.client_metadata).toEqual({ source: "codex" });
  });

  it("strips client_metadata when translating Responses requests to Chat Completions", () => {
    const translated = openaiResponsesToOpenAIRequest("deepseek-v4-pro", {
      model: "deepseek-v4-pro",
      input: "hello",
      client_metadata: { source: "codex-cli" },
    }, true);

    expect(translated).not.toHaveProperty("client_metadata");
    expect(translated.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hello" }] }]);
  });
});
