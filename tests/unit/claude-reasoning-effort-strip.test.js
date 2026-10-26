import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("Claude thinking / reasoning_effort stripping & normalization", () => {
  it("normalizeClaudePassthrough deletes reasoning_effort and maps to thinking budget when absent", () => {
    const body = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "medium",
    };
    normalizeClaudePassthrough(body, body.model);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });

  it("normalizeClaudePassthrough preserves existing thinking when reasoning_effort is present", () => {
    const body = {
      model: "claude-3-7-sonnet-20250219",
      messages: [{ role: "user", content: "hello" }],
      thinking: { type: "enabled", budget_tokens: 4000 },
      reasoning_effort: "high",
    };
    normalizeClaudePassthrough(body, body.model);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4000 });
  });

  it("normalizeClaudePassthrough maps reasoning_effort='none' to disabled thinking", () => {
    const body = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "none",
    };
    normalizeClaudePassthrough(body, body.model);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("prepareClaudeRequest removes lingering reasoning_effort", () => {
    const body = {
      model: "claude-haiku-5-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "low",
    };
    prepareClaudeRequest(body, "claude");
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("stripUnsupportedParams removes reasoning_effort for provider 'claude' and claude models", () => {
    const body1 = { model: "claude-opus-5", reasoning_effort: "medium" };
    stripUnsupportedParams("claude", "claude-opus-5", body1);
    expect(body1.reasoning_effort).toBeUndefined();

    const body2 = { model: "claude-3-5-sonnet", reasoning_effort: "high" };
    stripUnsupportedParams("custom-provider", "claude-3-5-sonnet", body2);
    expect(body2.reasoning_effort).toBeUndefined();
  });
});
