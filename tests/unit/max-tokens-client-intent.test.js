import { describe, it, expect } from "vitest";
import { adjustMaxTokens } from "../../open-sse/translator/formats/maxTokens.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { DEFAULT_MAX_TOKENS } from "../../open-sse/config/runtimeConfig.js";

describe("max_tokens client intent preservation", () => {
  describe("adjustMaxTokens", () => {
    it("returns wasExplicit=true when client provides max_tokens", () => {
      const { maxTokens, wasExplicit } = adjustMaxTokens({ max_tokens: 1000, messages: [{ role: "user", content: "hi" }] });
      expect(wasExplicit).toBe(true);
      expect(maxTokens).toBe(1000);
    });

    it("returns wasExplicit=false when client omits max_tokens", () => {
      const { maxTokens, wasExplicit } = adjustMaxTokens({ messages: [{ role: "user", content: "hi" }] });
      expect(wasExplicit).toBe(false);
      expect(maxTokens).toBe(DEFAULT_MAX_TOKENS);
    });

    it("preserves explicit client max_tokens even when below DEFAULT_MAX_TOKENS", () => {
      const { maxTokens, wasExplicit } = adjustMaxTokens({ max_tokens: 100, messages: [{ role: "user", content: "hi" }] });
      expect(wasExplicit).toBe(true);
      expect(maxTokens).toBe(100);
    });

    it("auto-increases for tools when client didn't set max_tokens", () => {
      const { maxTokens, wasExplicit } = adjustMaxTokens({ 
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }]
      });
      expect(wasExplicit).toBe(false);
      expect(maxTokens).toBeGreaterThanOrEqual(32000); // DEFAULT_MIN_TOKENS
    });

    it("respects explicit client max_tokens even with tools (does not auto-increase if client set a value)", () => {
      const { maxTokens, wasExplicit } = adjustMaxTokens({ 
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }]
      });
      expect(wasExplicit).toBe(true);
      expect(maxTokens).toBe(100); // Client's explicit value preserved
    });

    it("clamps to ceiling when ceiling is known (not DEFAULT_MAX_TOKENS) and client value exceeds it", () => {
      const { maxTokens } = adjustMaxTokens({ max_tokens: 200000, messages: [{ role: "user", content: "hi" }] }, 128000);
      expect(maxTokens).toBe(128000);
    });

    it("does NOT clamp to DEFAULT_MAX_TOKENS for unknown models when client provides explicit value", () => {
      // Ceiling is DEFAULT_MAX_TOKENS (64000) which means unknown model
      const { maxTokens } = adjustMaxTokens({ max_tokens: 100000, messages: [{ role: "user", content: "hi" }] }, DEFAULT_MAX_TOKENS);
      expect(maxTokens).toBe(100000); // Client value preserved for unknown model
    });

    it("reconciles max_tokens with thinking.budget_tokens (raises max_tokens)", () => {
      const { maxTokens } = adjustMaxTokens({ 
        max_tokens: 16000,
        thinking: { type: "enabled", budget_tokens: 32768 },
        messages: [{ role: "user", content: "hi" }]
      }, 64000);
      expect(maxTokens).toBe(33792); // 32768 + 1024
    });
  });

  describe("prepareClaudeRequest", () => {
    it("does NOT inject max_tokens for non-Anthropic providers when client omits it", () => {
      const out = prepareClaudeRequest({
        model: "some-model",
        messages: [{ role: "user", content: "hi" }],
      }, "openai-compatible-x");
      expect(out.max_tokens).toBeUndefined();
    });

    it("injects DEFAULT_MAX_TOKENS for Anthropic when client omits max_tokens", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4.6",
        messages: [{ role: "user", content: "hi" }],
      }, "claude");
      expect(out.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    });

    it("preserves explicit client max_tokens for Anthropic", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4.6",
        max_tokens: 100000,
        messages: [{ role: "user", content: "hi" }],
      }, "claude");
      // Should be clamped to model's maxOutput (128000 for Opus 4.6)
      expect(out.max_tokens).toBe(100000);
    });

    it("clamps explicit client max_tokens to known model ceiling (128000 for Opus 4.6+)", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4.6",
        max_tokens: 200000,
        messages: [{ role: "user", content: "hi" }],
      }, "claude");
      expect(out.max_tokens).toBe(128000); // Opus 4.6 maxOutput
    });

    it("does NOT clamp explicit client max_tokens to DEFAULT_MAX_TOKENS for unknown models", () => {
      const out = prepareClaudeRequest({
        model: "unknown-model",
        max_tokens: 100000,
        messages: [{ role: "user", content: "hi" }],
      }, "claude");
      // Unknown model - no real ceiling known, preserve client value
      expect(out.max_tokens).toBe(100000);
    });

    it("reconciles thinking budget with explicit client max_tokens", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4.6",
        max_tokens: 16000,
        thinking: { type: "enabled", budget_tokens: 32768 },
        messages: [{ role: "user", content: "hi" }],
      }, "claude");
      expect(out.max_tokens).toBe(33792); // budget + 1024, under ceiling
      expect(out.thinking.budget_tokens).toBe(32768);
    });
  });

  describe("stripUnsupportedParams", () => {
    it("clamps max_tokens for volcengine-ark GLM when exceeding model ceiling", () => {
      const body = { max_tokens: 131072, max_completion_tokens: 131072, max_output_tokens: 131072 };
      stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);
      expect(body.max_tokens).toBe(128000);
      expect(body.max_completion_tokens).toBe(128000);
      expect(body.max_output_tokens).toBe(128000);
    });

    it("does NOT clamp max_tokens for volcengine-ark GLM when under ceiling", () => {
      const body = { max_tokens: 64000 };
      stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);
      expect(body.max_tokens).toBe(64000);
    });

    it("clamps max_tokens for volcengine-ark Kimi to explicit cap (32768)", () => {
      const body = { max_tokens: 100000 };
      stripUnsupportedParams("volcengine-ark", "kimi-k2", body);
      expect(body.max_tokens).toBe(32768);
    });

    it("does NOT clamp max_tokens for providers without clamp rules", () => {
      const body = { max_tokens: 100000 };
      stripUnsupportedParams("groq", "qwen/qwen3.6-27b", body);
      expect(body.max_tokens).toBe(100000);
    });
  });
});