import { describe, expect, it } from "vitest";
import { buildComposite, ANCHOR_MODELS } from "../../src/lib/rankings/composite.js";

/** A board id must be a real metric id from budget.js to carry any weight. */
const board = (id, models) => ({ id, models });
const m = (slug, score, extra = {}) => ({ slug, score, ...extra });

/** Enough anchors present that scores can be published. */
const anchorBoard = (offset = 0) =>
  board(
    "aa",
    ANCHOR_MODELS.map((slug, i) => m(slug, 100 - i + offset)),
  );

describe("consensus catalog", () => {
  it("returns nothing when no board supplies anything", () => {
    expect(buildComposite([])).toEqual({ models: [], sources: [], comparisons: 0, anchorsUsed: 0 });
    expect(buildComposite(null).models).toEqual([]);
  });

  it("ignores boards whose id is not a declared metric", () => {
    // An unknown id must not silently receive weight.
    const result = buildComposite([board("not-a-real-source", [m("x", 1), m("y", 2)])]);
    expect(result.models).toEqual([]);
    expect(result.comparisons).toBe(0);
  });

  it("ranks by who beat whom", () => {
    const { models } = buildComposite([board("aa", [m("high", 90), m("mid", 50), m("low", 10)])]);
    const by = Object.fromEntries(models.map((x) => [x.slug, x.ability]));
    expect(by.high).toBeGreaterThan(by.mid);
    expect(by.mid).toBeGreaterThan(by.low);
  });

  it("accrues coverage from each board's declared budget", () => {
    const { models } = buildComposite([
      board("aa", [m("both", 5), m("aa-only", 4)]),
      board("livebench", [m("both", 5), m("lb-only", 4)]),
    ]);

    const both = models.find((x) => x.slug === "both");
    const aaOnly = models.find((x) => x.slug === "aa-only");
    // aa 10% + livebench 10%
    expect(both.coverage).toBeCloseTo(0.2, 10);
    expect(aaOnly.coverage).toBeCloseTo(0.1, 10);
  });

  it("counts distinct evidence families, not distinct boards", () => {
    const { models } = buildComposite([
      board("aa", [m("x", 5), m("y", 1)]),
      board("livebench", [m("x", 5), m("y", 1)]),
    ]);
    const x = models.find((r) => r.slug === "x");
    expect(x.ratedBy.sort()).toEqual(["aa", "livebench"]);
    // composite-intelligence + objective-rolling
    expect(x.evidenceFamilies).toBe(2);
  });

  it("never invents a result for a model a board did not include", () => {
    const { models } = buildComposite([
      board("aa", [m("rated", 5), m("also-rated", 1)]),
      board("livebench", [m("rated", 5), m("elsewhere", 1)]),
    ]);

    const alsoRated = models.find((x) => x.slug === "also-rated");
    // Absent from livebench → rated only by aa, and that absence is not a loss.
    expect(alsoRated.ratedBy).toEqual(["aa"]);
    expect(alsoRated.coverage).toBeCloseTo(0.1, 10);
  });

  it("does not redistribute an absent source's budget", () => {
    // Same board set, but one source is simply missing in the second case.
    const withBoth = buildComposite([
      board("aa", [m("x", 5), m("y", 1)]),
      board("livebench", [m("x", 5), m("y", 1)]),
    ]);
    const withOne = buildComposite([board("aa", [m("x", 5), m("y", 1)])]);

    const cov = (r, slug) => r.models.find((x) => x.slug === slug).coverage;
    // Coverage halves; it is NOT topped back up to the full budget.
    expect(cov(withBoth, "x")).toBeCloseTo(0.2, 10);
    expect(cov(withOne, "x")).toBeCloseTo(0.1, 10);
  });

  it("collapses effort configurations onto the base model", () => {
    // The base model is the ranking subject; a tier is an evaluation
    // configuration, so one representative is chosen and scored to the base.
    const { models } = buildComposite([
      board("aa", [m("claude-opus-5-low", 1), m("claude-opus-5-high", 9), m("gpt-5-6-sol", 5)]),
    ]);
    expect(models.map((x) => x.slug).sort()).toEqual(["claude-opus-5-high", "gpt-5-6-sol"]);
  });

  it("joins a config-suffixed slug on one board to the bare model on another", () => {
    // This is what makes cross-source evidence accumulate at all: LiveBench
    // publishes `-max-effort` variants that must meet AA's plain id.
    const { models } = buildComposite([
      board("aa", [m("claude-fable-5", 60), m("filler-model", 10)]),
      board("livebench", [m("claude-fable-5-max-effort", 83), m("filler-model-two", 10)]),
    ]);
    const fable = models.find((x) => x.slug.startsWith("claude-fable-5"));
    expect(fable.ratedBy.sort()).toEqual(["aa", "livebench"]);
    expect(fable.coverage).toBeCloseTo(0.2, 10);
  });

  it("joins the same model across boards despite id decoration", () => {
    const { models } = buildComposite([
      board("aa", [m("openai/gpt-4o", 5), m("filler", 1)]),
      board("livebench", [m("gpt-4o-2024-08-06", 5), m("filler2", 1)]),
    ]);
    const joined = models.find((x) => x.ratedBy.length === 2);
    expect(joined).toBeDefined();
    expect(joined.ratedBy.sort()).toEqual(["aa", "livebench"]);
  });

  it("adds models only a secondary board rates, widening coverage", () => {
    const { models } = buildComposite([
      board("aa", [m("known", 5), m("known2", 4)]),
      board("eqbench", [m("known", 5), m("exotic", 9)]),
    ]);
    expect(models.map((x) => x.slug)).toContain("exotic");
  });

  it("carries base-source metrics through for the single-metric presets", () => {
    const { models } = buildComposite([
      board("aa", [
        { slug: "m1", score: 50, metrics: { intelligenceIndex: 50, codingIndex: 40 } },
        { slug: "m2", score: 10, metrics: { intelligenceIndex: 10 } },
      ]),
    ]);
    const m1 = models.find((x) => x.slug === "m1");
    expect(m1.intelligenceIndex).toBe(50);
    expect(m1.codingIndex).toBe(40);
  });

  it("withholds the 0-100 score when too few anchors resolve", () => {
    // Ranking by ability is still valid; only the anchored scale is unavailable.
    const { models, anchorsUsed } = buildComposite([board("aa", [m("x", 5), m("y", 1)])]);
    expect(anchorsUsed).toBeLessThan(8);
    expect(models.every((r) => r.compositeScore === null)).toBe(true);
    expect(models.find((x) => x.slug === "x").ability).toBeGreaterThan(0);
  });

  it("publishes anchored scores once enough anchors are present", () => {
    const { models, anchorsUsed } = buildComposite([anchorBoard()]);
    expect(anchorsUsed).toBeGreaterThanOrEqual(8);
    for (const record of models) {
      expect(record.compositeScore).toBeGreaterThanOrEqual(0);
      expect(record.compositeScore).toBeLessThanOrEqual(100);
    }
    // The strongest anchor should outscore the weakest.
    const first = models.find((x) => x.slug === ANCHOR_MODELS[0]);
    const last = models.find((x) => x.slug === ANCHOR_MODELS[ANCHOR_MODELS.length - 1]);
    expect(first.compositeScore).toBeGreaterThan(last.compositeScore);
  });

  it("reports the boards that contributed and the comparison count", () => {
    const { sources, comparisons } = buildComposite([
      board("aa", [m("a", 3), m("b", 2), m("c", 1)]),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0].budget).toBeCloseTo(0.1, 10);
    // 3 models → 3 unique pairs.
    expect(comparisons).toBe(3);
  });
});
