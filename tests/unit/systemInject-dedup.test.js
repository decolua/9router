import { describe, it, expect, beforeEach } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("systemInject deduplication", () => {
  const TEST_PROMPT = "Respond like terse caveman. All technical substance stay exact, only fluff die.";
  const SHORT_SIGNATURE = TEST_PROMPT.slice(0, 100);

  describe("Claude format", () => {
    it("injects prompt into empty system string", () => {
      const body = { system: "" };
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toBe(TEST_PROMPT);
    });

    it("appends prompt to existing system string", () => {
      const body = { system: "Existing instruction." };
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toContain("Existing instruction.");
      expect(body.system).toContain(TEST_PROMPT);
    });

    it("does NOT duplicate when called twice on system string", () => {
      const body = { system: "Existing instruction." };
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      const afterFirst = body.system;
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toBe(afterFirst);
    });

    it("injects into system array without cache_control", () => {
      const body = { system: [{ type: "text", text: "Existing." }] };
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toHaveLength(2);
      expect(body.system[1].text).toBe(TEST_PROMPT);
    });

    it("does NOT duplicate when called twice on system array", () => {
      const body = { system: [{ type: "text", text: "Existing." }] };
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toHaveLength(2);
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toHaveLength(2);
    });

    it("inserts before cache_control block", () => {
      const body = {
        system: [
          { type: "text", text: "First." },
          { type: "text", text: "Second.", cache_control: { type: "ephemeral" } },
        ],
      };
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toHaveLength(3);
      expect(body.system[1].text).toBe(TEST_PROMPT);
      expect(body.system[2].cache_control).toBeDefined();
    });

    it("does NOT duplicate before cache_control on second call", () => {
      const body = {
        system: [
          { type: "text", text: "First." },
          { type: "text", text: "Second.", cache_control: { type: "ephemeral" } },
        ],
      };
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toHaveLength(3);
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toHaveLength(3);
    });
  });

  describe("OpenAI format", () => {
    it("creates system message if none exists", () => {
      const body = { messages: [{ role: "user", content: "Hello" }] };
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toBe(TEST_PROMPT);
    });

    it("appends to existing system message", () => {
      const body = { messages: [{ role: "system", content: "Existing." }] };
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      expect(body.messages[0].content).toContain("Existing.");
      expect(body.messages[0].content).toContain(TEST_PROMPT);
    });

    it("does NOT duplicate when called twice", () => {
      const body = { messages: [{ role: "system", content: "Existing." }] };
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      const afterFirst = body.messages[0].content;
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      expect(body.messages[0].content).toBe(afterFirst);
    });

    it("handles developer role", () => {
      const body = { messages: [{ role: "developer", content: "Existing." }] };
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      expect(body.messages[0].content).toContain(TEST_PROMPT);
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      expect(body.messages[0].content.split(SHORT_SIGNATURE)).toHaveLength(2);
    });

    it("handles array content in Responses API", () => {
      const body = {
        messages: [
          { role: "system", content: [{ type: "input_text", text: "Existing." }] },
        ],
      };
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      expect(body.messages[0].content).toHaveLength(2);
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      expect(body.messages[0].content).toHaveLength(2);
    });

    it("handles instructions field", () => {
      const body = { instructions: "Existing instruction." };
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      expect(body.instructions).toContain("Existing instruction.");
      expect(body.instructions).toContain(TEST_PROMPT);
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      expect(body.instructions.split(SHORT_SIGNATURE)).toHaveLength(2);
    });
  });

  describe("Gemini format", () => {
    it("creates systemInstruction if none exists", () => {
      const body = {};
      injectSystemPrompt(body, FORMATS.GEMINI, TEST_PROMPT);
      expect(body.systemInstruction).toBeDefined();
      expect(body.systemInstruction.parts[0].text).toBe(TEST_PROMPT);
    });

    it("appends to existing systemInstruction", () => {
      const body = { systemInstruction: { parts: [{ text: "Existing." }] } };
      injectSystemPrompt(body, FORMATS.GEMINI, TEST_PROMPT);
      expect(body.systemInstruction.parts).toHaveLength(2);
    });

    it("does NOT duplicate when called twice", () => {
      const body = { systemInstruction: { parts: [{ text: "Existing." }] } };
      injectSystemPrompt(body, FORMATS.GEMINI, TEST_PROMPT);
      expect(body.systemInstruction.parts).toHaveLength(2);
      injectSystemPrompt(body, FORMATS.GEMINI, TEST_PROMPT);
      expect(body.systemInstruction.parts).toHaveLength(2);
    });

    it("handles snake_case system_instruction", () => {
      const body = { system_instruction: { parts: [{ text: "Existing." }] } };
      injectSystemPrompt(body, FORMATS.GEMINI, TEST_PROMPT);
      expect(body.system_instruction.parts).toHaveLength(2);
      injectSystemPrompt(body, FORMATS.GEMINI, TEST_PROMPT);
      expect(body.system_instruction.parts).toHaveLength(2);
    });

    it("handles Antigravity wrapped format", () => {
      const body = { request: { systemInstruction: { parts: [{ text: "Existing." }] } } };
      injectSystemPrompt(body, FORMATS.ANTIGRAVITY, TEST_PROMPT);
      expect(body.request.systemInstruction.parts).toHaveLength(2);
      injectSystemPrompt(body, FORMATS.ANTIGRAVITY, TEST_PROMPT);
      expect(body.request.systemInstruction.parts).toHaveLength(2);
    });
  });

  describe("multi-turn conversation simulation", () => {
    it("does NOT accumulate duplicates across multiple turns (Claude)", () => {
      const body = { system: "Base instruction." };

      // Turn 1
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      const turn1 = body.system;
      expect(turn1.split(SHORT_SIGNATURE)).toHaveLength(2);

      // Turn 2 (simulating same conversation continuing)
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toBe(turn1);

      // Turn 3
      injectSystemPrompt(body, FORMATS.CLAUDE, TEST_PROMPT);
      expect(body.system).toBe(turn1);
      expect(body.system.split(SHORT_SIGNATURE)).toHaveLength(2);
    });

    it("does NOT accumulate duplicates across multiple turns (OpenAI)", () => {
      const body = { messages: [{ role: "system", content: "Base instruction." }] };

      // Turn 1
      injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      const turn1 = body.messages[0].content;
      expect(turn1.split(SHORT_SIGNATURE)).toHaveLength(2);

      // Turn 2-5
      for (let i = 0; i < 4; i++) {
        injectSystemPrompt(body, FORMATS.OPENAI, TEST_PROMPT);
      }
      expect(body.messages[0].content).toBe(turn1);
      expect(body.messages[0].content.split(SHORT_SIGNATURE)).toHaveLength(2);
    });
  });
});
