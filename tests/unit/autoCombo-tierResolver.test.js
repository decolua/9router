import { describe, it, expect } from "vitest";
import { classifyTier } from "../../open-sse/services/autoCombo/tierResolver.js";

const VALID_TIERS = new Set(["free", "cheap", "premium"]);

describe("classifyTier", () => {
  it("returns a valid tier for every call", () => {
    for (const [provider, model] of [
      ["anthropic", "claude-sonnet-4.6"],
      ["openai", "gpt-4o"],
      ["unknown", "unknown-model"],
    ]) {
      const result = classifyTier(provider, model);
      expect(VALID_TIERS.has(result.tier), `tier must be valid for ${provider}/${model}`).toBe(true);
      expect(typeof result.costPerMTok).toBe("number");
      expect(result.costPerMTok).toBeGreaterThanOrEqual(0);
    }
  });

  it("claude-sonnet-4.6 → premium", () => {
    const r = classifyTier("anthropic", "claude-sonnet-4.6");
    expect(r.tier).toBe("premium");
    expect(r.costPerMTok).toBeGreaterThan(0);
  });

  it("gpt-4o → premium", () => {
    const r = classifyTier("openai", "gpt-4o");
    expect(r.tier).toBe("premium");
    expect(r.costPerMTok).toBeGreaterThan(0);
  });

  it("gpt-4o-mini → cheap", () => {
    const r = classifyTier("openai", "gpt-4o-mini");
    expect(r.tier).toBe("cheap");
  });

  it("llama-3.3-70b → free", () => {
    const r = classifyTier("meta", "llama-3.3-70b");
    expect(r.tier).toBe("free");
    expect(r.costPerMTok).toBe(0);
  });

  it("ollama provider with unknown model → free", () => {
    const r = classifyTier("ollama", "some-local-model");
    expect(r.tier).toBe("free");
  });

  it("deepseek-chat → cheap", () => {
    const r = classifyTier("deepseek", "deepseek-chat");
    expect(r.tier).toBe("cheap");
  });

  it("unknown provider + unknown model → cheap fallback", () => {
    const r = classifyTier("bogusprovider", "no-such-model");
    expect(r.tier).toBe("cheap");
  });

  it("model with provider prefix stripped correctly", () => {
    const withPrefix = classifyTier("anthropic", "anthropic/claude-sonnet-4.6");
    const bare = classifyTier("anthropic", "claude-sonnet-4.6");
    expect(withPrefix.tier).toBe(bare.tier);
    expect(withPrefix.costPerMTok).toBe(bare.costPerMTok);
  });

  it("tier is always one of free|cheap|premium", () => {
    const probes = [
      ["anthropic", "claude-opus-4"],
      ["openai", "gpt-3.5-turbo"],
      ["google", "gemini-2.5-pro"],
      ["meta", "llama-2-7b"],
      ["xai", "grok-3"],
      ["groq", "whatever"],
      ["", ""],
    ];
    for (const [provider, model] of probes) {
      const { tier } = classifyTier(provider, model);
      expect(VALID_TIERS.has(tier), `invalid tier "${tier}" for ${provider}/${model}`).toBe(true);
    }
  });
  it("versioned mini variant not misclassified as base (prefix-order regression)", () => {
    // gpt-4o-mini-2024-07-18 must match "gpt-4o-mini" (cheap), not "gpt-4o" (premium)
    const r = classifyTier("openai", "gpt-4o-mini-2024-07-18");
    expect(r.tier).toBe("cheap");
  });

});
