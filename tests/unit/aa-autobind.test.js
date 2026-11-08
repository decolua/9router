import { describe, expect, it } from "vitest";
import { buildIndex, autoBindUnmatched, matchModels } from "../../src/lib/aa/match.js";

const CATALOG = [
  { slug: "gpt-5-6-sol", name: "GPT-5.6 Sol", creator: "OpenAI", intelligenceIndex: 60.9 },
  { slug: "gpt-5-6-luna", name: "GPT-5.6 Luna", creator: "OpenAI", intelligenceIndex: 52.3 },
  { slug: "gpt-5-6-terra", name: "GPT-5.6 Terra", creator: "OpenAI", intelligenceIndex: 56.6 },
  { slug: "claude-opus-5", name: "Claude Opus 5", creator: "Anthropic", intelligenceIndex: 63.1 },
  { slug: "kimi-k3", name: "Kimi K3", creator: "Moonshot AI", intelligenceIndex: 59.7 },
];

describe("auto-binding unmatched models", () => {
  const index = buildIndex(CATALOG);

  it("binds an unmatched model to its closest catalog entry", () => {
    // "gpt-5.6" has no entry of its own — only the named variants.
    const { bindings } = autoBindUnmatched(["openai/gpt-5.6"], index, {});
    expect(bindings["openai/gpt-5.6"]).toMatch(/^gpt-5-6-/);
  });

  it("reports the full shortlist alongside the pick, so a guess stays correctable", () => {
    const { bindings, suggestions } = autoBindUnmatched(["openai/gpt-5.6"], index, {});
    const shortlist = suggestions["openai/gpt-5.6"];

    expect(shortlist.length).toBeGreaterThan(1);
    expect(shortlist.map((c) => c.slug)).toContain(bindings["openai/gpt-5.6"]);
    // Shortlist is ordered strongest-first.
    expect(shortlist[0].score).toBeGreaterThanOrEqual(shortlist[1].score);
  });

  it("never overrides an explicit user binding", () => {
    const { bindings } = autoBindUnmatched(["openai/gpt-5.6"], index, {
      "openai/gpt-5.6": "gpt-5-6-terra",
    });
    // Present in userBindings → left entirely to the caller.
    expect(bindings).not.toHaveProperty("openai/gpt-5.6");
  });

  it('respects an explicit "leave unranked" so it is not re-bound next pass', () => {
    // Empty string means the user looked at it and chose to leave it out.
    const { bindings } = autoBindUnmatched(["openai/gpt-5.6"], index, { "openai/gpt-5.6": "" });
    expect(bindings).not.toHaveProperty("openai/gpt-5.6");
  });

  it("leaves a model with no plausible candidate unbound", () => {
    const { bindings, suggestions } = autoBindUnmatched(["acme/totally-unrelated-thing"], index, {});
    expect(bindings).not.toHaveProperty("acme/totally-unrelated-thing");
    expect(suggestions).not.toHaveProperty("acme/totally-unrelated-thing");
  });

  it("handles empty input", () => {
    expect(autoBindUnmatched([], index, {})).toEqual({ bindings: {}, suggestions: {} });
    expect(autoBindUnmatched(undefined, index, {})).toEqual({ bindings: {}, suggestions: {} });
  });

  it("feeds back into matchModels so the auto-bound model actually gets ranked", () => {
    const models = ["openai/gpt-5.6", "anthropic/claude-opus-5"];
    const first = matchModels(models, CATALOG, {});
    expect(first.unmatched).toContain("openai/gpt-5.6");

    const { bindings } = autoBindUnmatched(first.unmatched, index, {});
    const second = matchModels(models, CATALOG, bindings);

    expect(second.unmatched).toEqual([]);
    expect(second.matched).toHaveLength(2);
    expect(second.matched.find((m) => m.modelStr === "openai/gpt-5.6").confidence).toBe("manual");
  });
});
