import { describe, it, expect } from "vitest";
import { injectCustomPrompt, resolveComboPrompt, MAX_COMBO_PROMPT_CHARS } from "../../open-sse/rtk/customPrompt.js";
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

describe("resolveComboPrompt", () => {
  it("returns an empty string when nothing is configured", () => {
    expect(resolveComboPrompt()).toBe("");
    expect(resolveComboPrompt(undefined)).toBe("");
    expect(resolveComboPrompt("", "   ", null, 42, {})).toBe("");
  });

  it("trims and caps a single prompt", () => {
    expect(resolveComboPrompt("  Keep answers short.  ")).toBe("Keep answers short.");
    expect(resolveComboPrompt("x".repeat(MAX_COMBO_PROMPT_CHARS + 50)).length).toBe(MAX_COMBO_PROMPT_CHARS);
  });

  it("joins outer and nested combo prompts, outermost first, skipping empty ones", () => {
    expect(resolveComboPrompt("OUTER", "INNER")).toBe(`OUTER${SEP}INNER`);
    expect(resolveComboPrompt("", "INNER")).toBe("INNER");
    expect(resolveComboPrompt("OUTER", undefined)).toBe("OUTER");
  });

  it("an empty combo prompt injects nothing", () => {
    const body = { messages: [{ role: ROLE.USER, content: "hi" }] };
    expect(injectCustomPrompt(body, FORMATS.OPENAI, resolveComboPrompt(undefined))).toBe(false);
    expect(body.messages).toEqual([{ role: ROLE.USER, content: "hi" }]);
  });

  it("is appended after the global custom prompt and the client system prompt", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: "client" }, { role: ROLE.USER, content: "hi" }] };
    injectCustomPrompt(body, FORMATS.OPENAI, "GLOBAL");
    injectCustomPrompt(body, FORMATS.OPENAI, resolveComboPrompt("COMBO"));
    expect(body.messages[0].content).toBe(`client${SEP}GLOBAL${SEP}COMBO`);
  });
});
