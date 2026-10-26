/**
 * Regression for #5108: a client that sends thinking.budget_tokens must not have
 * it thrown away. Strict OpenAI-compatible upstreams reject
 * thinking:{type:"enabled"} with "missing field `budget_tokens`", which kills the
 * first entry of a combo and takes the whole combo down with it.
 */
import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const MODEL = "deepseek-v4.1-flash"; // capabilities: thinkingFormat "deepseek"

describe("applyThinking (deepseek): keep the client's budget_tokens", () => {
  it("passes budget_tokens through instead of dropping it", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 2048 }, max_tokens: 4096 };
    const out = applyThinking(FORMATS.OPENAI, MODEL, body, "opencode-go");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  it("still emits a bare enabled marker when the client sent no budget", () => {
    const body = { reasoning_effort: "high", max_tokens: 4096 };
    const out = applyThinking(FORMATS.OPENAI, MODEL, body, "opencode-go");
    expect(out.thinking).toEqual({ type: "enabled" });
  });

  it("keeps the disabled marker when the client asks to turn thinking off", () => {
    const body = { thinking: { type: "disabled" }, max_tokens: 4096 };
    const out = applyThinking(FORMATS.OPENAI, MODEL, body, "opencode-go");
    expect(out.thinking).toEqual({ type: "disabled" });
  });
});
