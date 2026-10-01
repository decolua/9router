// Regression: claude->openai must not pre-clamp max_tokens at the conservative
// 64000 default. High-output CodeBuddy models (deepseek-v4.1-flash maxOutput
// 128000, MiniMax-M3 128000) would otherwise be truncated on long autonomous
// turns. Mirrors the model-aware ceiling already present on the reverse leg
// (openai-to-claude.js).
import { describe, expect, it } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

const run = (model, max_tokens, provider) =>
  claudeToOpenAIRequest(model, { max_tokens, messages: [] }, true, provider ? { _provider: provider } : null).max_tokens;

describe("claudeToOpenAIRequest model-aware max_tokens ceiling", () => {
  it("raises the ceiling above 64000 for a high-output CodeBuddy model", () => {
    expect(run("deepseek-v4.1-flash", 100000, "codebuddy-intl")).toBe(100000);
  });

  it("clamps to the provider-scoped ceiling, not the canonical model entry", () => {
    // canonical deepseek-v4.1-flash declares 384000; codebuddy-intl declares 128000
    expect(run("deepseek-v4.1-flash", 200000, "codebuddy-intl")).toBe(128000);
  });

  it("clamps to a lower CodeBuddy ceiling (glm-5.3 = 48000)", () => {
    expect(run("glm-5.3", 50000, "codebuddy-intl")).toBe(48000);
  });

  it("falls back to the model-only lookup when no provider is threaded", () => {
    expect(run("deepseek-v4.1-flash", 100000, null)).toBe(100000);
  });
});
