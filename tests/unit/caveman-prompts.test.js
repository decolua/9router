import { describe, it, expect } from "vitest";
import { CAVEMAN_LEVELS, CAVEMAN_PROMPTS } from "../../open-sse/rtk/cavemanPrompts.js";

const LEVEL_KEYS = [
  CAVEMAN_LEVELS.LITE,
  CAVEMAN_LEVELS.FULL,
  CAVEMAN_LEVELS.ULTRA,
  CAVEMAN_LEVELS.WENYAN_LITE,
  CAVEMAN_LEVELS.WENYAN,
  CAVEMAN_LEVELS.WENYAN_ULTRA,
];

describe("Caveman prompt coverage", () => {
  it("every level key has matching prompt and vice versa", () => {
    const levelValues = Object.values(CAVEMAN_LEVELS);
    for (const key of LEVEL_KEYS) {
      expect(levelValues).toContain(key);
    }
    for (const value of levelValues) {
      expect(LEVEL_KEYS).toContain(value);
    }
  });

  it("has a prompt string for every level", () => {
    for (const level of LEVEL_KEYS) {
      expect(typeof CAVEMAN_PROMPTS[level]).toBe("string");
      expect(CAVEMAN_PROMPTS[level].length).toBeGreaterThan(0);
    }
  });

  it("adds no-invented-abbreviations guidance to every level", () => {
    for (const level of LEVEL_KEYS) {
      expect(CAVEMAN_PROMPTS[level]).toContain("No invented abbreviations");
    }
  });

  it("adds preserve-user-language guidance to every level", () => {
    for (const level of LEVEL_KEYS) {
      expect(CAVEMAN_PROMPTS[level]).toContain("Preserve the user's dominant language");
    }
  });

  it("adds no-self-reference guidance to every level", () => {
    for (const level of LEVEL_KEYS) {
      expect(CAVEMAN_PROMPTS[level]).toContain("No self-reference");
    }
  });

  it("adds no-decorative-emoji guidance to every level", () => {
    for (const level of LEVEL_KEYS) {
      expect(CAVEMAN_PROMPTS[level]).toContain("No decorative emoji");
    }
  });
});

describe("Caveman internal consistency", () => {
  it("no level uses Unicode arrow (SHARED_NO_DECORATION bans arrow shorthand)", () => {
    // SHARED_NO_DECORATION uses ASCII -> to quote the banned pattern.
    // Unicode → is the character old ULTRA used in "Pattern: [thing] → [result]".
    // Verify no level now uses it.
    for (const level of LEVEL_KEYS) {
      expect(CAVEMAN_PROMPTS[level]).not.toContain("→");
    }
  });
});

describe("Caveman ULTRA targeted sync", () => {
  it("does not encourage invented abbreviations", () => {
    const ultra = CAVEMAN_PROMPTS[CAVEMAN_LEVELS.ULTRA];
    expect(ultra).not.toContain("req/res/fn/impl");
    expect(ultra).not.toContain("Abbreviate (DB/auth/config/req/res/fn/impl)");
  });

  it("does not encourage arrow shorthand", () => {
    const ultra = CAVEMAN_PROMPTS[CAVEMAN_LEVELS.ULTRA];
    expect(ultra).not.toContain("use arrows for causality");
    expect(ultra).not.toContain("X → Y");
  });
});
