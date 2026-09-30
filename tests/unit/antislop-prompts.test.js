import { describe, it, expect } from "vitest";
import { ANTISLOP_SCOPES, ANTISLOP_PROMPTS } from "../../open-sse/rtk/antislopPrompts.js";

const SCOPE_KEYS = [
  ANTISLOP_SCOPES.UI,
  ANTISLOP_SCOPES.BALANCED,
  ANTISLOP_SCOPES.FULL,
];

describe("Antislop prompt coverage", () => {
  it("every scope key has matching prompt and vice versa", () => {
    const scopeValues = Object.values(ANTISLOP_SCOPES);
    for (const key of SCOPE_KEYS) {
      expect(scopeValues).toContain(key);
    }
    for (const value of scopeValues) {
      expect(SCOPE_KEYS).toContain(value);
    }
  });

  it("has a prompt string for every scope", () => {
    for (const scope of SCOPE_KEYS) {
      expect(typeof ANTISLOP_PROMPTS[scope]).toBe("string");
      expect(ANTISLOP_PROMPTS[scope].length).toBeGreaterThan(0);
    }
  });

  it("states the purpose test in every scope", () => {
    for (const scope of SCOPE_KEYS) {
      expect(ANTISLOP_PROMPTS[scope]).toContain("purpose test");
    }
  });

  it("bans fabricated claims in every scope", () => {
    for (const scope of SCOPE_KEYS) {
      expect(ANTISLOP_PROMPTS[scope]).toContain("fabricated");
    }
  });
});

describe("Antislop scope layering", () => {
  it("balanced adds copy rules over ui", () => {
    expect(ANTISLOP_PROMPTS[ANTISLOP_SCOPES.BALANCED]).toContain("em dash");
    expect(ANTISLOP_PROMPTS[ANTISLOP_SCOPES.UI]).not.toContain("em dash");
  });

  it("full adds people and mobile rules over balanced", () => {
    expect(ANTISLOP_PROMPTS[ANTISLOP_SCOPES.FULL]).toContain("WCAG AA");
    expect(ANTISLOP_PROMPTS[ANTISLOP_SCOPES.BALANCED]).not.toContain("WCAG AA");
  });
});
