/**
 * Unit tests for AntigravityExecutor.transformRequest — Gemini thinking-budget injection.
 *
 * Bug: Antigravity model aliases encode a thinking tier as a suffix
 * (gemini-3.1-pro-low / -high). Without an explicit generationConfig.thinkingConfig,
 * Gemini reasoning models spend their whole output budget on hidden reasoning tokens
 * and emit (near-)empty content. transformRequest must derive a bounded thinkingBudget
 * from the suffix (only when the client did not set one) and guarantee output headroom.
 *
 * Budget tiers mirror open-sse/translator/request/openai-to-gemini.js
 * ({ low:1024, medium:8192, high:32768 }); AG output cap = 16384.
 */
import { describe, it, expect } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const ex = new AntigravityExecutor();
const creds = { projectId: "proj-1", email: "e@x.io", connectionId: "c1" };

function mkBody(generationConfig = {}) {
  return {
    request: {
      sessionId: "sess-1",
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig,
    },
  };
}
const gc = (model, generationConfig = {}) =>
  ex.transformRequest(model, mkBody(generationConfig), true, creds).request.generationConfig;

describe("AntigravityExecutor.transformRequest — thinking-budget injection", () => {
  it("injects low thinkingBudget for gemini-3.1-pro-low and guarantees output headroom", () => {
    const g = gc("gemini-3.1-pro-low");
    expect(g.thinkingConfig).toBeDefined();
    expect(g.thinkingConfig.thinkingBudget).toBe(1024);
    expect(g.maxOutputTokens).toBe(16384);
  });

  it("injects a clamped high thinkingBudget for gemini-3.1-pro-high", () => {
    const g = gc("gemini-3.1-pro-high");
    // high tier (32768) clamped so >=2048 tokens remain for visible output within the 16384 cap
    expect(g.thinkingConfig.thinkingBudget).toBe(14336);
    expect(g.maxOutputTokens).toBe(16384);
  });

  it("does NOT override a client-provided thinkingConfig.thinkingBudget", () => {
    const g = gc("gemini-3.1-pro-low", { thinkingConfig: { thinkingBudget: 512 } });
    expect(g.thinkingConfig.thinkingBudget).toBe(512);
  });

  it("does NOT inject for non-gemini models routed via Antigravity (claude)", () => {
    const g = gc("claude-opus-4-6-thinking");
    expect(g.thinkingConfig).toBeUndefined();
  });

  it("does NOT inject for a gemini model without a thinking-tier suffix (flash)", () => {
    const g = gc("gemini-3-flash");
    expect(g.thinkingConfig).toBeUndefined();
  });

  it("still clamps an oversized client maxOutputTokens to the AG cap", () => {
    const g = gc("gemini-3.1-pro-low", { maxOutputTokens: 999999 });
    expect(g.maxOutputTokens).toBe(16384);
    expect(g.thinkingConfig.thinkingBudget).toBe(1024);
  });

  it("preserves a sufficiently large client maxOutputTokens", () => {
    const g = gc("gemini-3.1-pro-low", { maxOutputTokens: 12000 });
    expect(g.maxOutputTokens).toBe(12000);
    expect(g.thinkingConfig.thinkingBudget).toBe(1024);
  });
});
