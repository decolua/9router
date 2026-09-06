/**
 * Unit tests for the max_tokens → max_completion_tokens mapping in the
 * *-to-openai request translators.
 *
 * OpenAI's Chat Completions API rejects `max_tokens` for gpt-5.x / o-series
 * models with 400 unsupported_parameter:
 *   "Unsupported parameter: 'max_tokens' is not supported with this model.
 *    Use 'max_completion_tokens' instead."
 * The GitHub executor already maps the param (requiresMaxCompletionTokens);
 * these tests pin the same mapping at the translator layer so requests built
 * from Claude/Gemini/Antigravity ingress are born with the right param for
 * every executor, including the native openai api-key provider.
 */

import { describe, it, expect } from "vitest";
import { requiresMaxCompletionTokens } from "../../open-sse/translator/formats/maxTokens.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { geminiToOpenAIRequest } from "../../open-sse/translator/request/gemini-to-openai.js";
import { antigravityToOpenAIRequest } from "../../open-sse/translator/request/antigravity-to-openai.js";

describe("requiresMaxCompletionTokens", () => {
  it("matches gpt-5 family and hyphenated o-series ids", () => {
    for (const model of ["gpt-5", "gpt-5.4", "gpt-5.4-mini", "GPT-5-nano", "o1-preview", "o3-mini", "o4-mini"]) {
      expect(requiresMaxCompletionTokens(model), model).toBe(true);
    }
  });

  it("leaves older OpenAI models on max_tokens", () => {
    for (const model of ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4-turbo", "claude-sonnet-4-6", "gemini-2.5-pro"]) {
      expect(requiresMaxCompletionTokens(model), model).toBe(false);
    }
  });
});

describe("claude-to-openai max tokens param", () => {
  const body = { max_tokens: 2048, messages: [{ role: "user", content: "hi" }] };

  it("emits max_completion_tokens for gpt-5 models", () => {
    const result = claudeToOpenAIRequest("gpt-5.4-mini", body, false);
    expect(result.max_completion_tokens).toBe(2048);
    expect(result.max_tokens).toBeUndefined();
  });

  it("emits max_completion_tokens for o-series models", () => {
    const result = claudeToOpenAIRequest("o3-mini", body, false);
    expect(result.max_completion_tokens).toBe(2048);
    expect(result.max_tokens).toBeUndefined();
  });

  it("keeps max_tokens for older models", () => {
    const result = claudeToOpenAIRequest("gpt-4o", body, false);
    expect(result.max_tokens).toBe(2048);
    expect(result.max_completion_tokens).toBeUndefined();
  });
});

describe("gemini-to-openai max tokens param", () => {
  const body = { generationConfig: { maxOutputTokens: 1024 }, contents: [] };

  it("emits max_completion_tokens for gpt-5 models", () => {
    const result = geminiToOpenAIRequest("gpt-5", body, false);
    expect(result.max_completion_tokens).toBe(1024);
    expect(result.max_tokens).toBeUndefined();
  });

  it("keeps max_tokens for older models", () => {
    const result = geminiToOpenAIRequest("gpt-4o", body, false);
    expect(result.max_tokens).toBe(1024);
    expect(result.max_completion_tokens).toBeUndefined();
  });
});

describe("antigravity-to-openai max tokens param", () => {
  const body = { request: { generationConfig: { maxOutputTokens: 1024 }, contents: [] } };

  it("emits max_completion_tokens for gpt-5 models", () => {
    const result = antigravityToOpenAIRequest("gpt-5.4", body, false);
    expect(result.max_completion_tokens).toBe(1024);
    expect(result.max_tokens).toBeUndefined();
  });

  it("keeps max_tokens for older models", () => {
    const result = antigravityToOpenAIRequest("gpt-4o", body, false);
    expect(result.max_tokens).toBe(1024);
    expect(result.max_completion_tokens).toBeUndefined();
  });
});
