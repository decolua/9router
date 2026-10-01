import { describe, it, expect } from "vitest";
import {
  ANTISLOP_UI_PROMPT,
  ANTISLOP_COPY_HUMAN_PROMPT,
} from "../../open-sse/rtk/antislopPrompts.js";

describe("Antislop prompts", () => {
  it("ui prompt states the purpose test", () => {
    expect(typeof ANTISLOP_UI_PROMPT).toBe("string");
    expect(ANTISLOP_UI_PROMPT).toContain("purpose test");
  });

  it("ui prompt caps decoration and bans fabricated claims", () => {
    expect(ANTISLOP_UI_PROMPT).toContain("max 1-2");
    expect(ANTISLOP_UI_PROMPT).toContain("fabricated");
  });

  it("copy-human prompt bans copy tells", () => {
    expect(typeof ANTISLOP_COPY_HUMAN_PROMPT).toBe("string");
    expect(ANTISLOP_COPY_HUMAN_PROMPT).toContain("em dash");
    expect(ANTISLOP_COPY_HUMAN_PROMPT).toContain("Hope this helps");
    expect(ANTISLOP_COPY_HUMAN_PROMPT).toContain("Let's dive in");
  });

  it("copy-human prompt holds human blockers", () => {
    expect(ANTISLOP_COPY_HUMAN_PROMPT).toContain("WCAG AA");
    expect(ANTISLOP_COPY_HUMAN_PROMPT).toContain("outline none");
    expect(ANTISLOP_COPY_HUMAN_PROMPT).toContain("44px");
  });

  it("prompts differ", () => {
    expect(ANTISLOP_UI_PROMPT).not.toBe(ANTISLOP_COPY_HUMAN_PROMPT);
  });
});
