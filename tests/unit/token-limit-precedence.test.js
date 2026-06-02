import { describe, expect, it } from "vitest";
import { adjustMaxTokens, getTokenLimit } from "../../open-sse/translator/helpers/maxTokensHelper.js";
import { DEFAULT_MAX_TOKENS } from "../../open-sse/config/runtimeConfig.js";
import { openaiToCommandCode } from "../../open-sse/translator/request/openai-to-commandcode.js";
import { buildCursorRequest } from "../../open-sse/translator/request/openai-to-cursor.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { openaiToOllamaRequest } from "../../open-sse/translator/request/openai-to-ollama.js";

const bodyWithBothLimits = {
  messages: [{ role: "user", content: "hello" }],
  max_tokens: 111,
  max_completion_tokens: 222
};

describe("OpenAI token-limit precedence", () => {
  it("prefers max_completion_tokens in the shared helpers", () => {
    expect(getTokenLimit(bodyWithBothLimits)).toBe(222);
    expect(adjustMaxTokens(bodyWithBothLimits)).toBe(222);
  });

  it("ignores non-positive token limits before falling back", () => {
    expect(getTokenLimit({ max_completion_tokens: 0, max_tokens: 111 })).toBe(111);
    expect(getTokenLimit({ max_completion_tokens: -1, max_tokens: 111 })).toBe(111);
    expect(getTokenLimit({ max_completion_tokens: 0, max_tokens: 0 }, 333)).toBe(333);
    expect(adjustMaxTokens({ max_tokens: 0 })).toBe(DEFAULT_MAX_TOKENS);
  });

  it("uses the same precedence for Gemini maxOutputTokens", () => {
    const result = openaiToGeminiRequest("gemini-test", bodyWithBothLimits, false);
    expect(result.generationConfig.maxOutputTokens).toBe(222);
  });

  it("uses the same precedence for Ollama num_predict", () => {
    const result = openaiToOllamaRequest("ollama-test", bodyWithBothLimits, false);
    expect(result.options.num_predict).toBe(222);
  });

  it("uses the same precedence for Cursor max_tokens", () => {
    const result = buildCursorRequest("cursor-test", bodyWithBothLimits, false);
    expect(result.max_tokens).toBe(222);
  });

  it("uses the same precedence for CommandCode max_tokens", () => {
    const result = openaiToCommandCode("commandcode-test", bodyWithBothLimits, false);
    expect(result.params.max_tokens).toBe(222);
  });
});
