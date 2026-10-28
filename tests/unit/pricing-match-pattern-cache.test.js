import { describe, it, expect } from "vitest";
import { matchPattern } from "../../open-sse/providers/pricing.js";

// #4622: matchPattern caches compiled regexes; results must be unchanged.
function reference(pattern, model) {
  return new RegExp("^" + pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i").test(model);
}

describe("matchPattern regex cache", () => {
  const patterns = ["grok-*", "gpt-5*", "claude-*-4*", "*-free", "MiniMax-M2.5", "a.b*", "x+y*", "(weird)*", "*"];
  const models = ["grok-code-fast", "GPT-5.6-luna", "claude-sonnet-4-5", "oc/glm-free", "minimax-m2.5", "a.bc", "axbc", "x+yz", "(weird)1", ""];

  it("matches exactly like a freshly compiled regex, repeatedly", () => {
    for (let round = 0; round < 3; round++) {
      for (const p of patterns) for (const m of models) {
        expect(matchPattern(p, m), `${p} vs ${m}`).toBe(reference(p, m));
      }
    }
  });
});
