import { describe, it, expect } from "vitest";

import { parseAaLeaderboard, extractFlightPayload, extractModelsArray } from "../../src/lib/aa/parse.js";
import { normalizeModelId, looseModelId, similarity, matchModels, buildIndex, matchModel } from "../../src/lib/aa/match.js";
import { rankModels, scoreModel, RANKING_PRESETS } from "../../src/lib/aa/presets.js";

/**
 * Build a leaderboard-shaped document. The real page splits one logical flight
 * chunk across several script pushes, so the fixture does too — that split is
 * exactly what a naive per-push JSON.parse gets wrong.
 */
function buildFixture(models, { split = true } = {}) {
  const inner = JSON.stringify({ models });
  const payload = `33:["$","div",null,${inner.slice(0, 0)}${inner}]`;
  const encoded = JSON.stringify(payload).slice(1, -1);
  if (!split) {
    return `<script>self.__next_f.push([1,"${encoded}"])</script>`;
  }
  const mid = Math.floor(encoded.length / 2);
  // Do not split inside an escape sequence.
  let cut = mid;
  while (cut > 0 && encoded[cut - 1] === "\\") cut -= 1;
  return (
    `<script>self.__next_f.push([1,"${encoded.slice(0, cut)}"])</script>` +
    `<script>self.__next_f.push([1,"${encoded.slice(cut)}"])</script>`
  );
}

const SAMPLE = [
  {
    slug: "claude-opus-5", name: "Claude Opus 5", modelCreatorName: "Anthropic",
    intelligenceIndex: 60.7, codingIndex: 78.0, agenticIndex: 55.3, tau2: 0.91,
    openrouterApiId: "anthropic/claude-opus-5", price1mBlended3To1: 12.5,
    terminalBench40: 55, terminalbenchHard: 40, scicode: 45,
    hle: 30, critpt: 12, gpqa: 82, lcr: 60, ifbench: 70, omniscience: 55, tauBanking: 40,
  },
  {
    slug: "gpt-5-6-sol", name: "GPT-5.6 Sol", modelCreatorName: "OpenAI",
    intelligenceIndex: 58.9, codingIndex: 77.4, agenticIndex: 54.0, tau2: 0.88,
    openrouterApiId: "openai/gpt-5.6-sol", price1mBlended3To1: 6.0,
    terminalBench40: 50, terminalbenchHard: 35, scicode: 40,
    hle: 25, critpt: 10, gpqa: 78, lcr: 50, ifbench: 65, omniscience: 50, tauBanking: 35,
  },
  {
    // Only the general index: exercises both renormalization and the floor.
    slug: "cheap-model", name: "Cheap Model", modelCreatorName: "Budget",
    intelligenceIndex: 30.0, codingIndex: null, agenticIndex: null, tau2: null,
    openrouterApiId: "budget/cheap-model", price1mBlended3To1: 0.1,
  },
];

describe("AA leaderboard parsing", () => {
  it("decodes flight chunks that are split across pushes", () => {
    const html = buildFixture(SAMPLE);
    const flight = extractFlightPayload(html);
    expect(flight).toContain("intelligenceIndex");
    expect(extractModelsArray(flight)).toHaveLength(3);
  });

  it("parses an unsplit document too", () => {
    const { models, count } = parseAaLeaderboard(buildFixture(SAMPLE, { split: false }));
    expect(count).toBe(3);
    expect(models[0].slug).toBe("claude-opus-5");
    expect(models[0].intelligenceIndex).toBeCloseTo(60.7);
    expect(models[0].priceBlended).toBeCloseTo(12.5);
  });

  // Fail-open: a page redesign must degrade to "no new data", never throw.
  it("returns an empty result for unrecognisable html instead of throwing", () => {
    expect(parseAaLeaderboard("<html><body>nothing here</body></html>")).toEqual({ models: [], count: 0 });
    expect(parseAaLeaderboard("")).toEqual({ models: [], count: 0 });
    expect(parseAaLeaderboard(null)).toEqual({ models: [], count: 0 });
  });

  it("survives a truncated flight payload", () => {
    const html = buildFixture(SAMPLE).slice(0, 120);
    expect(() => parseAaLeaderboard(html)).not.toThrow();
  });

  it("keeps the strongest variant when a slug repeats", () => {
    const dup = [...SAMPLE, { ...SAMPLE[0], intelligenceIndex: 10 }];
    const { models } = parseAaLeaderboard(buildFixture(dup));
    const opus = models.find((m) => m.slug === "claude-opus-5");
    expect(opus.intelligenceIndex).toBeCloseTo(60.7);
  });
});

describe("model id matching", () => {
  it("normalizes separators, vendor prefixes and release stamps", () => {
    expect(normalizeModelId("anthropic/claude-opus-4.6")).toBe("claude-opus-4-6");
    expect(normalizeModelId("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5");
    expect(normalizeModelId("gemini-3.0-pro-latest")).toBe("gemini-3-0-pro");
  });

  it("strips serving and effort suffixes only in the loose form", () => {
    expect(normalizeModelId("llama-3.3-70b-instruct-fp8-fast")).toBe("llama-3-3-70b-instruct-fp8-fast");
    expect(looseModelId("llama-3.3-70b-instruct-fp8-fast")).toBe("llama-3-3-70b");
    expect(looseModelId("gpt-oss-120b-medium")).toBe("gpt-oss-120b");
  });

  it("prefers the openrouter id over slug and loose matching", () => {
    const index = buildIndex(SAMPLE);
    expect(matchModel("anthropic/claude-opus-5", index).confidence).toBe("exact-openrouter");
    expect(matchModel("p/cheap-model", index).confidence).toBe("exact-openrouter");
  });

  it("reports unmatched models rather than force-fitting them", () => {
    const { matched, unmatched } = matchModels(["anthropic/claude-opus-5", "p/totally-unknown-xyz"], SAMPLE);
    expect(matched).toHaveLength(1);
    expect(unmatched).toEqual(["p/totally-unknown-xyz"]);
  });

  it("honours a manual binding over automatic matching", () => {
    const { matched } = matchModels(["p/totally-unknown-xyz"], SAMPLE, { "p/totally-unknown-xyz": "cheap-model" });
    expect(matched[0].confidence).toBe("manual");
    expect(matched[0].aa.slug).toBe("cheap-model");
  });

  it("skips the fuzzy scan when disabled", () => {
    const index = buildIndex(SAMPLE);
    // Close enough for fuzzy, not an exact or loose key.
    expect(matchModel("p/claude-opus-5-turbo", index, { fuzzy: false }).model).toBeNull();
  });

  it("scores similarity between 0 and 1", () => {
    expect(similarity("claude-opus-5", "claude-opus-5")).toBe(1);
    expect(similarity("claude-opus-5", "gpt-5-6-sol")).toBeLessThan(0.3);
  });
});

describe("ranking presets", () => {
  // Rank the parser's output, not the raw fixture: ranking consumes normalized
  // records (priceBlended), so using raw AA field names would silently skip the
  // price path and make the value preset look like it worked.
  const PARSED = parseAaLeaderboard(buildFixture(SAMPLE)).models;

  it("normalizes price into the ranked shape", () => {
    expect(PARSED.find((m) => m.slug === "cheap-model").priceBlended).toBeCloseTo(0.1);
  });

  it("carries the per-benchmark metrics the dimensions score on", () => {
    const m = PARSED.find((x) => x.slug === "claude-opus-5");
    expect(m.terminalBench40).toBeCloseTo(55);
    expect(m.hle).toBeCloseTo(30);
    expect(m.tauBanking).toBeCloseTo(40);
  });

  it("orders by a dimension", () => {
    const ranked = rankModels(PARSED, "knowledge");
    expect(ranked.map((r) => r.model.slug)).toEqual(["claude-opus-5", "gpt-5-6-sol", "cheap-model"]);
  });

  it("scores a model on the metrics it has, not the ones it lacks", () => {
    const partial = [...PARSED, { slug: "partial", name: "Partial", intelligenceIndex: 50, gpqa: 70, lcr: 40 }];
    const row = rankModels(partial, "knowledge").find((r) => r.model.slug === "partial");
    // intelligenceIndex .30 + lcr .20 + gpqa .20 = 0.70 of the dimension
    expect(row.coverage).toBeCloseTo(0.7);
    expect(row.score).not.toBeNull();
  });

  it("reports a model as unranked when too little of the dimension was measured", () => {
    // Renormalization would otherwise hand a model carrying one easy metric a
    // perfect score and put it on top of the whole dimension.
    const cheap = rankModels(PARSED, "knowledge").find((r) => r.model.slug === "cheap-model");
    expect(cheap.score).toBeNull();
    expect(cheap.coverage).toBeCloseTo(0.3);
    expect(cheap.insufficientEvidence).toBe(true);
  });

  it("puts models with no usable metric last instead of dropping them", () => {
    const withBlank = [...PARSED, { slug: "blank", name: "Blank" }];
    const ranked = rankModels(withBlank, "knowledge");
    expect(ranked).toHaveLength(4);
    expect(ranked[ranked.length - 1].model.slug).toBe("blank");
    expect(ranked[ranked.length - 1].score).toBeNull();
  });

  it("ranks the general dimension on the multi-leaderboard consensus", () => {
    const withComposite = [
      { slug: "high", compositeScore: 90 },
      { slug: "low", compositeScore: 20 },
    ];
    expect(rankModels(withComposite, "general").map((r) => r.model.slug)).toEqual(["high", "low"]);
  });

  it("returns a null score when the preset has no usable metric", () => {
    const result = scoreModel({ slug: "x" }, RANKING_PRESETS.coding, {});
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
  });
});
