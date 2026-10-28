import { describe, it, expect } from "vitest";
import { injectCustomPrompt } from "../../open-sse/rtk/customPrompt.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/roles.js";

const SEP = "\n\n";

describe("injectCustomPrompt", () => {
  it("does nothing when the prompt is empty or blank", () => {
    const body = { messages: [{ role: ROLE.USER, content: "hi" }] };
    expect(injectCustomPrompt(body, FORMATS.OPENAI, "")).toBe(false);
    expect(injectCustomPrompt(body, FORMATS.OPENAI, "   \n\t")).toBe(false);
    expect(injectCustomPrompt(body, FORMATS.OPENAI, undefined)).toBe(false);
    expect(body.messages).toEqual([{ role: ROLE.USER, content: "hi" }]);
  });

  it("appends the prompt to an existing system message", () => {
    const body = {
      messages: [
        { role: ROLE.SYSTEM, content: "hello" },
        { role: ROLE.USER, content: "hi" },
      ],
    };
    expect(injectCustomPrompt(body, FORMATS.OPENAI, "MY PROMPT")).toBe(true);
    expect(body.messages[0].content).toBe(`hello${SEP}MY PROMPT`);
  });

  it("creates a system message when none exists", () => {
    const body = { messages: [{ role: ROLE.USER, content: "hi" }] };
    injectCustomPrompt(body, FORMATS.OPENAI, "MY PROMPT");
    expect(body.messages[0]).toEqual({ role: ROLE.SYSTEM, content: "MY PROMPT" });
  });

  it("is idempotent for the same prompt", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: "hello" }] };
    injectCustomPrompt(body, FORMATS.OPENAI, "MY PROMPT");
    injectCustomPrompt(body, FORMATS.OPENAI, "MY PROMPT");
    expect(body.messages[0].content).toBe(`hello${SEP}MY PROMPT`);
  });

  it("lands in the Claude system field, not messages[]", () => {
    const body = {
      system: "hello",
      messages: [{ role: ROLE.USER, content: "hi" }],
    };
    injectCustomPrompt(body, FORMATS.CLAUDE, "MY PROMPT");
    expect(body.system).toBe(`hello${SEP}MY PROMPT`);
    expect(body.messages).toEqual([{ role: ROLE.USER, content: "hi" }]);
  });

  it("lands in the Gemini systemInstruction field", () => {
    const body = { contents: [{ role: ROLE.USER, parts: [{ text: "hi" }] }] };
    injectCustomPrompt(body, FORMATS.GEMINI, "MY PROMPT");
    expect(body.systemInstruction).toEqual({ parts: [{ text: "MY PROMPT" }] });
  });

  it("lands in the Responses instructions field", () => {
    const body = { instructions: "hello", input: [] };
    injectCustomPrompt(body, FORMATS.OPENAI_RESPONSES, "MY PROMPT");
    expect(body.instructions).toBe(`hello${SEP}MY PROMPT`);
  });
});
