import { describe, it, expect } from "vitest";
import { getModelCapabilities, sanitizeBodyForModel } from "../../open-sse/services/modelCapabilities.js";

describe("modelCapabilities", () => {
  describe("getModelCapabilities", () => {
    it("returns default capabilities for unknown models", () => {
      const caps = getModelCapabilities("unknown", "model-x");
      expect(caps.thinking.supported).toBe(true);
      expect(caps.maxTokens.field).toBe("max_tokens");
    });

    it("returns correctly for Gemini 3 Flash", () => {
      const caps = getModelCapabilities("antigravity", "gemini-3-flash");
      expect(caps.thinking.supported).toBe(false);
    });

    it("returns correctly for Qwen models", () => {
      const caps = getModelCapabilities("qwen", "qwen-max");
      expect(caps.thinking.incompatibleWithRequiredToolChoice).toBe(true);
    });

    it("returns correctly for GitHub models", () => {
      const caps = getModelCapabilities("github", "gpt-4o");
      expect(caps.maxTokens.field).toBe("max_completion_tokens");
    });
  });

  describe("sanitizeBodyForModel", () => {
    it("strips thinking and reasoning_effort if not supported", () => {
      const body = { messages: [], thinking: { type: "auto" }, reasoning_effort: "high" };
      const caps = { thinking: { supported: false }, reasoningEffort: { supported: false } };
      const sanitized = sanitizeBodyForModel(body, caps);
      expect(sanitized.thinking).toBeUndefined();
      expect(sanitized.reasoning_effort).toBeUndefined();
      expect(body.thinking).toBeDefined(); // Ensures original body is isolated/unchanged
    });

    it("handles Qwen tool_choice incompatibility", () => {
      const body = { messages: [], thinking: { type: "auto" }, tool_choice: "required" };
      const caps = { thinking: { supported: true, incompatibleWithRequiredToolChoice: true } };
      const sanitized = sanitizeBodyForModel(body, caps);
      expect(sanitized.tool_choice).toBe("auto");
      expect(sanitized.thinking).toBeUndefined(); // Thinking stripped
    });

    it("renames max_tokens if needed", () => {
      const body = { messages: [], max_tokens: 1000 };
      const caps = { maxTokens: { field: "max_completion_tokens" } };
      const sanitized = sanitizeBodyForModel(body, caps);
      expect(sanitized.max_tokens).toBeUndefined();
      expect(sanitized.max_completion_tokens).toBe(1000);
    });

    it("strips temperature if not supported", () => {
      const body = { messages: [], temperature: 0.5 };
      const caps = { temperature: { supported: false } };
      const sanitized = sanitizeBodyForModel(body, caps);
      expect(sanitized.temperature).toBeUndefined();
    });
  });
});
