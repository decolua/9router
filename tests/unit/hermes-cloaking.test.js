import { describe, it, expect } from "vitest";
import {
  sanitizeAntigravitySystemPrompt,
  openaiToAntigravityRequest,
  openaiToGeminiRequest,
  openaiToGeminiCLIRequest,
} from "../../open-sse/translator/request/openai-to-gemini.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

describe("Hermes Cloaking / System Prompt Sanitization", () => {
  const HERMES_PROMPT = "You are Hermes Agent, an intelligent AI assistant created by Nous Research. You assist users with coding and tools.";
  const SANITIZED_HERMES_PROMPT = "You are Hermes Agent. You are an intelligent AI assistant created by Nous Research. You assist users with coding and tools.";

  describe("sanitizeAntigravitySystemPrompt", () => {
    it("replaces exact Hermes Agent opening sentence", () => {
      expect(sanitizeAntigravitySystemPrompt(HERMES_PROMPT)).toBe(SANITIZED_HERMES_PROMPT);
    });

    it("handles variations in whitespace and casing", () => {
      const varied = "you are hermes agent,   an intelligent ai assistant created by nous research. Extra instructions.";
      const result = sanitizeAntigravitySystemPrompt(varied);
      expect(result).toBe("You are Hermes Agent. You are an intelligent AI assistant created by Nous Research. Extra instructions.");
    });

    it("leaves non-matching system prompts untouched", () => {
      const normalPrompt = "You are an expert TypeScript developer.";
      expect(sanitizeAntigravitySystemPrompt(normalPrompt)).toBe(normalPrompt);
    });

    it("handles null, undefined, and non-string values safely", () => {
      expect(sanitizeAntigravitySystemPrompt(null)).toBe(null);
      expect(sanitizeAntigravitySystemPrompt(undefined)).toBe(undefined);
      expect(sanitizeAntigravitySystemPrompt(123)).toBe(123);
    });
  });

  describe("openaiToAntigravityRequest", () => {
    it("sanitizes Hermes system prompt in Gemini-backed Antigravity envelope", () => {
      const req = openaiToAntigravityRequest("gemini-3.7-flash-high", {
        messages: [
          { role: "system", content: HERMES_PROMPT },
          { role: "user", content: "hello" },
        ],
      }, false, { projectId: "test-proj", connectionId: "test-conn" });

      expect(req.request.systemInstruction?.parts?.[0]?.text).toBe(SANITIZED_HERMES_PROMPT);
    });

    it("sanitizes Hermes system prompt in Claude-backed Antigravity envelope", () => {
      const req = openaiToAntigravityRequest("claude-opus-4-6-thinking", {
        messages: [
          { role: "system", content: HERMES_PROMPT },
          { role: "user", content: "hello" },
        ],
      }, false, { projectId: "test-proj", connectionId: "test-conn" });

      expect(req.request.systemInstruction?.parts?.[0]?.text).toBe(SANITIZED_HERMES_PROMPT);
    });
  });
});
