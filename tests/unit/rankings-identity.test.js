import { describe, expect, it } from "vitest";
import {
  baseModelOf,
  configOf,
  configPriority,
  selectRepresentatives,
} from "../../src/lib/rankings/identity.js";

describe("base model extraction", () => {
  it("leaves a plain model id alone", () => {
    expect(baseModelOf("claude-fable-5")).toBe("claude-fable-5");
    expect(baseModelOf("gpt-4o")).toBe("gpt-4o");
  });

  it("strips reasoning-effort tiers", () => {
    expect(baseModelOf("claude-fable-5-max-effort")).toBe("claude-fable-5");
    expect(baseModelOf("gpt-5.6-sol-max")).toBe("gpt-5.6-sol");
    expect(baseModelOf("gpt-5.5-xhigh")).toBe("gpt-5.5");
    expect(baseModelOf("claude-opus-5-low")).toBe("claude-opus-5");
  });

  it("strips stacked configuration suffixes", () => {
    expect(baseModelOf("claude-4-1-opus-thinking-32k")).toBe("claude-4-1-opus");
    expect(baseModelOf("llama-3.3-70b-instruct-fp8-fast")).toBe("llama-3.3-70b");
  });

  it("strips harness and scaffold markers", () => {
    expect(baseModelOf("claude-4-1-opus-20250805-base")).toBe("claude-4-1-opus-20250805");
    expect(baseModelOf("some-model-agentic")).toBe("some-model");
  });

  it("keeps version markers, which identify different weights", () => {
    // A date or preview tag is not a configuration — it is a different model.
    expect(baseModelOf("claude-4-1-opus-20250805")).toBe("claude-4-1-opus-20250805");
    expect(baseModelOf("gemini-3-1-pro-preview")).toBe("gemini-3-1-pro-preview");
    expect(baseModelOf("deepseek-v4-pro-0424")).toBe("deepseek-v4-pro-0424");
  });

  it("never strips a whole id away", () => {
    expect(baseModelOf("-high")).toBe("-high");
    expect(baseModelOf("")).toBe("");
    expect(baseModelOf(null)).toBe("");
  });

  it("reports the configuration it removed", () => {
    expect(configOf("claude-opus-5-high")).toBe("high");
    expect(configOf("claude-opus-5")).toBe(null);
  });
});

describe("representative configuration selection", () => {
  it("prefers the bare model over any tier", () => {
    const [rep] = selectRepresentatives([
      { slug: "claude-opus-5-high", score: 99 },
      { slug: "claude-opus-5", score: 1 },
      { slug: "claude-opus-5-low", score: 50 },
    ]);
    // Chosen by fixed priority, NOT by the 99 that -high scored.
    expect(rep.slug).toBe("claude-opus-5");
    expect(rep.score).toBe(1);
  });

  it("does not let a high score promote a configuration", () => {
    const [rep] = selectRepresentatives([
      { slug: "claude-opus-5-low", score: 100 },
      { slug: "claude-opus-5-high", score: 0 },
    ]);
    // -high outranks -low in the fixed order regardless of the scores.
    expect(rep.slug).toBe("claude-opus-5-high");
    expect(configPriority("claude-opus-5-high")).toBeLessThan(
      configPriority("claude-opus-5-low"),
    );
  });

  it("collapses every configuration onto one base model", () => {
    const reps = selectRepresentatives([
      { slug: "claude-opus-5-high", score: 1 },
      { slug: "claude-opus-5-low", score: 2 },
      { slug: "gpt-5-6-sol", score: 3 },
    ]);
    expect(reps).toHaveLength(2);
    expect(reps.map((r) => r.baseModel).sort()).toEqual(["claude-opus-5", "gpt-5-6-sol"]);
  });

  it("keeps every configuration listed for audit", () => {
    const [rep] = selectRepresentatives([
      { slug: "claude-opus-5-high", score: 1 },
      { slug: "claude-opus-5-low", score: 2 },
    ]);
    expect(rep.configurations.sort()).toEqual(["claude-opus-5-high", "claude-opus-5-low"]);
  });

  it("picks the same representative regardless of input order", () => {
    const forward = selectRepresentatives([
      { slug: "claude-opus-5-low", score: 1 },
      { slug: "claude-opus-5-high", score: 2 },
    ]);
    const reversed = selectRepresentatives([
      { slug: "claude-opus-5-high", score: 2 },
      { slug: "claude-opus-5-low", score: 1 },
    ]);
    expect(forward[0].slug).toBe(reversed[0].slug);
  });

  it("skips entries with no id", () => {
    expect(selectRepresentatives([{ score: 1 }, { slug: "ok-model", score: 2 }])).toHaveLength(1);
    expect(selectRepresentatives([])).toEqual([]);
    expect(selectRepresentatives(null)).toEqual([]);
  });
});
