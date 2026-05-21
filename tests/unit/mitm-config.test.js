import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MODEL_SYNONYMS, MODEL_PATTERNS } = require("../../src/mitm/config.js");

describe("Antigravity MITM model mappings", () => {
  it("maps explicit Antigravity aliases to current and legacy canonical models", () => {
    expect(MODEL_SYNONYMS.antigravity["gemini-default"]).toBe("gemini-3.5-flash");
    expect(MODEL_SYNONYMS.antigravity["gemini-3.5-flash-high"]).toBe("gemini-3.5-flash-high");
    expect(MODEL_SYNONYMS.antigravity["gemini-3.5-flash-medium"]).toBe("gemini-3.5-flash-medium");
    expect(MODEL_SYNONYMS.antigravity["gemini-3.5-flash"]).toBe("gemini-3.5-flash");
    expect(MODEL_SYNONYMS.antigravity["gemini-3-flash"]).toBe("gemini-3-flash");
    expect(MODEL_SYNONYMS.antigravity["claude-opus-4-7"]).toBeUndefined();
    expect(MODEL_SYNONYMS.antigravity["claude-opus-4-7-thinking"]).toBeUndefined();
    expect(MODEL_SYNONYMS.antigravity["claude-opus-4-6"]).toBe("claude-opus-4-6-thinking");
  });

  it("falls back to current Flash and Opus aliases for renamed raw models", () => {
    const patternAliasFor = (rawModel) => MODEL_PATTERNS.antigravity.find(({ match }) => match.test(rawModel))?.alias;

    expect(patternAliasFor("Gemini Flash Default")).toBe("gemini-3.5-flash");
    expect(patternAliasFor("Gemini Flash High")).toBe("gemini-3.5-flash-high");
    expect(patternAliasFor("Gemini Medium Flash")).toBe("gemini-3.5-flash-medium");
    expect(patternAliasFor("Claude Opus")).toBe("claude-opus-4-6-thinking");
  });
});
