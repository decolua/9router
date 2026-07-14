/**
 * Regression tests for caveman injection.
 * Adapted from decolua/9router PR #1658, adjusted to fork signature:
 *  - CAVEMAN_PROMPTS[level] (string, not object)
 *  - injectCaveman(body, format, level) where level is "lite"|"full"|"ultra"
 *  - FORMATS.* imported from translator/formats.js
 */

import { describe, it, expect } from "vitest";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { CAVEMAN_PROMPTS, CAVEMAN_LEVELS } from "../../open-sse/rtk/cavemanPrompts.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("caveman injection — OpenAI chat format", () => {
  it("injects into existing system message (string content)", () => {
    const body = { messages: [{ role: "system", content: "You are helpful." }] };
    injectCaveman(body, FORMATS.OPENAI, CAVEMAN_LEVELS.FULL);
    expect(body.messages[0].content).toContain("You are helpful.");
    expect(body.messages[0].content).toContain(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.FULL]);
  });

  it("creates system message when none exists", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    injectCaveman(body, FORMATS.OPENAI, CAVEMAN_LEVELS.LITE);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.LITE]);
  });

  it("appends to array content (Responses-style)", () => {
    const body = {
      messages: [{ role: "system", content: [{ type: "input_text", text: "base" }] }]
    };
    injectCaveman(body, FORMATS.OPENAI, CAVEMAN_LEVELS.ULTRA);
    const last = body.messages[0].content[body.messages[0].content.length - 1];
    expect(last.type).toBe("input_text");
    expect(last.text).toBe(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.ULTRA]);
  });
});

describe("caveman injection — OpenAI Responses format", () => {
  it("injects into instructions string", () => {
    const body = { instructions: "Be helpful.", messages: [] };
    injectCaveman(body, FORMATS.OPENAI, CAVEMAN_LEVELS.FULL);
    expect(body.instructions).toContain("Be helpful.");
    expect(body.instructions).toContain(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.FULL]);
  });

  it("creates instructions when body has input array", () => {
    const body = { input: [{ role: "user", content: "hi" }] };
    injectCaveman(body, FORMATS.OPENAI, CAVEMAN_LEVELS.LITE);
    expect(body.input[0].role).toBe("system");
    expect(body.input[0].content).toBe(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.LITE]);
  });
});

describe("caveman injection — Claude format", () => {
  it("injects into body.system string", () => {
    const body = { system: "Base system prompt." };
    injectCaveman(body, FORMATS.CLAUDE, CAVEMAN_LEVELS.FULL);
    expect(body.system).toContain("Base system prompt.");
    expect(body.system).toContain(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.FULL]);
  });

  it("injects into body.system array before last cache_control", () => {
    const body = {
      system: [
        { type: "text", text: "first", cache_control: { type: "ephemeral" } },
        { type: "text", text: "second" }
      ]
    };
    injectCaveman(body, FORMATS.CLAUDE, CAVEMAN_LEVELS.ULTRA);
    expect(body.system.length).toBe(3);
    // splice inserts at lastCacheIdx (0), pushing cached block to index 1
    expect(body.system[0].text).toBe(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.ULTRA]);
    expect(body.system[1].text).toBe("first");
    expect(body.system[2].text).toBe("second");
  });

  it("appends to body.system array without cache_control", () => {
    const body = {
      system: [{ type: "text", text: "first" }]
    };
    injectCaveman(body, FORMATS.CLAUDE, CAVEMAN_LEVELS.LITE);
    expect(body.system.length).toBe(2);
    expect(body.system[1].text).toBe(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.LITE]);
  });

  it("creates body.system when missing", () => {
    const body = {};
    injectCaveman(body, FORMATS.CLAUDE, CAVEMAN_LEVELS.FULL);
    expect(body.system).toBe(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.FULL]);
  });
});

describe("caveman injection — Gemini format", () => {
  it("injects into systemInstruction.parts", () => {
    const body = { systemInstruction: { parts: [{ text: "base" }] } };
    injectCaveman(body, FORMATS.GEMINI, CAVEMAN_LEVELS.FULL);
    expect(body.systemInstruction.parts.length).toBe(2);
    expect(body.systemInstruction.parts[1].text).toBe(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.FULL]);
  });

  it("creates systemInstruction when missing", () => {
    const body = {};
    injectCaveman(body, FORMATS.GEMINI, CAVEMAN_LEVELS.LITE);
    expect(body.systemInstruction.parts.length).toBe(1);
    expect(body.systemInstruction.parts[0].text).toBe(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.LITE]);
  });

  it("injects into body.request.systemInstruction (Antigravity/VERTEX shape)", () => {
    const body = { request: { systemInstruction: { parts: [{ text: "base" }] } } };
    injectCaveman(body, FORMATS.ANTIGRAVITY, CAVEMAN_LEVELS.FULL);
    expect(body.request.systemInstruction.parts.length).toBe(2);
    expect(body.request.systemInstruction.parts[1].text).toBe(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.FULL]);
  });
});

describe("caveman injection — edge cases", () => {
  it("does not crash on null body", () => {
    expect(() => injectCaveman(null, FORMATS.OPENAI, CAVEMAN_LEVELS.FULL)).not.toThrow();
  });

  it("does not crash on undefined level", () => {
    const body = { messages: [] };
    expect(() => injectCaveman(body, FORMATS.OPENAI, undefined)).not.toThrow();
    expect(body.messages.length).toBe(0);
  });

  it("does not inject when level is invalid", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectCaveman(body, FORMATS.OPENAI, "nonexistent");
    expect(body.messages.length).toBe(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("each level produces a distinct prompt", () => {
    const levels = Object.values(CAVEMAN_LEVELS);
    const prompts = levels.map(l => CAVEMAN_PROMPTS[l]);
    const unique = new Set(prompts);
    expect(unique.size).toBe(levels.length);
  });

  it("all prompts are at least 50 characters", () => {
    for (const prompt of Object.values(CAVEMAN_PROMPTS)) {
      expect(prompt.length).toBeGreaterThan(50);
    }
  });
});
