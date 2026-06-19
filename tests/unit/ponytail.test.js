import { describe, it, expect } from "vitest";
import { injectPonytail } from "../../open-sse/rtk/ponytail.js";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { PONYTAIL_PROMPTS, PONYTAIL_LEVELS } from "../../open-sse/rtk/ponytailPrompts.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const FULL = PONYTAIL_PROMPTS[PONYTAIL_LEVELS.FULL];

describe("injectPonytail", () => {
  it("appends to an existing OpenAI system message", () => {
    const body = { messages: [{ role: "system", content: "Base." }, { role: "user", content: "hi" }] };
    injectPonytail(body, FORMATS.OPENAI, "full");
    expect(body.messages[0].content).toBe(`Base.\n\n${FULL}`);
  });

  it("prepends a system message when none exists (OpenAI)", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectPonytail(body, FORMATS.OPENAI, "full");
    expect(body.messages[0]).toEqual({ role: "system", content: FULL });
    expect(body.messages[1].role).toBe("user");
  });

  it("appends to the OpenAI Responses instructions string", () => {
    const body = { instructions: "Base.", input: [] };
    injectPonytail(body, FORMATS.OPENAI_RESPONSES, "full");
    expect(body.instructions).toBe(`Base.\n\n${FULL}`);
  });

  it("appends to a Claude system string", () => {
    const body = { system: "Base." };
    injectPonytail(body, FORMATS.CLAUDE, "full");
    expect(body.system).toBe(`Base.\n\n${FULL}`);
  });

  it("inserts before the last cache_control block in a Claude system array", () => {
    const body = { system: [{ type: "text", text: "Base.", cache_control: { type: "ephemeral" } }] };
    injectPonytail(body, FORMATS.CLAUDE, "full");
    expect(body.system).toHaveLength(2);
    expect(body.system[0]).toEqual({ type: "text", text: FULL });
    expect(body.system[1].cache_control).toBeDefined();
  });

  it("adds a Gemini systemInstruction part", () => {
    const body = { systemInstruction: { parts: [{ text: "Base." }] } };
    injectPonytail(body, FORMATS.GEMINI, "full");
    expect(body.systemInstruction.parts).toHaveLength(2);
    expect(body.systemInstruction.parts[1]).toEqual({ text: FULL });
  });

  it("uses the lite prompt for the lite level", () => {
    const body = { messages: [] };
    injectPonytail(body, FORMATS.OPENAI, "lite");
    expect(body.messages[0].content).toBe(PONYTAIL_PROMPTS[PONYTAIL_LEVELS.LITE]);
  });

  it("is a no-op for an unknown level", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectPonytail(body, FORMATS.OPENAI, "nope");
    expect(body.messages).toHaveLength(1);
  });

  it("is a no-op for a missing body", () => {
    expect(() => injectPonytail(null, FORMATS.OPENAI, "full")).not.toThrow();
  });
});

describe("shared injector keeps caveman working", () => {
  it("still injects caveman after the refactor", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectCaveman(body, FORMATS.OPENAI, "full");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content.length).toBeGreaterThan(0);
  });
});
