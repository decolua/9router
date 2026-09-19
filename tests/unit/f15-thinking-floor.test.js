// F15 / T1.2 M7 — `reasoning_effort:"minimal"` mapped to budget_tokens 512, but
// Anthropic rejects `thinking.budget_tokens < 1024` with a 400. The repo already
// treats 1024 as the floor on the OTHER axis (formats/claude.js:521,
// `Math.max(1024, max_tokens - 1024)`); the entry axis never got it, and
// claude-sonnet-4-5 declares `thinkingRange: null`, so no clamp ran at all.
// A client-supplied `thinking.budget_tokens: 512` also passed through intact.
import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

const MODEL = "claude-sonnet-4-5"; // thinkingFormat: claude-budget, thinkingRange: null
const ANTHROPIC_MIN_THINKING_BUDGET = 1024;

function toClaude(overrides) {
  const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 4096, ...overrides };
  return translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, MODEL, body, true, { apiKey: "sk-x" }, "claude");
}

describe("F15 M7 — thinking budget floor (claude-budget)", () => {
  it("effort=minimal lands on the Anthropic minimum, never 512", () => {
    const out = toClaude({ reasoning_effort: "minimal" });
    expect(out.thinking?.type).toBe("enabled");
    expect(out.thinking.budget_tokens).toBeGreaterThanOrEqual(ANTHROPIC_MIN_THINKING_BUDGET);
  });

  it("budget stays below max_tokens so the answer still has room", () => {
    const out = toClaude({ reasoning_effort: "minimal" });
    expect(out.thinking.budget_tokens).toBeLessThan(out.max_tokens);
  });

  it("an explicit client budget below the floor is raised, not forwarded", () => {
    const out = toClaude({ thinking: { type: "enabled", budget_tokens: 512 } });
    expect(out.thinking.type).toBe("enabled");
    expect(out.thinking.budget_tokens).toBeGreaterThanOrEqual(ANTHROPIC_MIN_THINKING_BUDGET);
  });

  it("the same client budget is raised on the claude→claude (same-format) leg", () => {
    // applyThinking runs on the target format even when no conversion happens,
    // so a Claude-format client sending 512 must not reach Anthropic verbatim.
    const body = {
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: "hi" }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      thinking: { type: "enabled", budget_tokens: 512 },
    };
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, MODEL, body, true, { apiKey: "sk-x" }, "claude");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: ANTHROPIC_MIN_THINKING_BUDGET });
  });

  it("efforts at or above the floor keep their mapped budgets", () => {
    const expectBudget = (effort, budget) => {
      const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 64000, reasoning_effort: effort };
      applyThinking(FORMATS.CLAUDE, MODEL, body, "claude");
      expect(body.thinking, `effort ${effort} dropped thinking`).toEqual({ type: "enabled", budget_tokens: budget });
    };
    expectBudget("low", 1024);
    expectBudget("medium", 8192);
    expectBudget("high", 24576);
  });

  it("disabling thinking is not resurrected into a 1024 budget", () => {
    const out = toClaude({ reasoning_effort: "none" });
    // claude-sonnet-4-5 can disable thinking → must stay disabled/absent.
    expect(out.thinking?.budget_tokens ?? 0).toBe(0);
  });

  it("auto thinking (no budget requested) is untouched by the floor", () => {
    const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 4096, thinking: { type: "enabled" } };
    applyThinking(FORMATS.CLAUDE, MODEL, body, "claude");
    expect(body.thinking).toEqual({ type: "enabled" });
  });
});
