import { describe, expect, it } from "vitest";
import {
  pairwiseFromBoard,
  fitBradleyTerry,
  scoreAgainstAnchors,
  sigmoid,
  FULL_EVIDENCE_BUDGET,
} from "../../src/lib/rankings/bradleyTerry.js";
import { listMetrics, familyTotals, SOURCE_GROUPS, FAMILY_CAP } from "../../src/lib/rankings/budget.js";

const e = (key, score, extra = {}) => ({ key, score, ...extra });

describe("evidence budget", () => {
  it("totals exactly 100% across ten independent source groups", () => {
    const groups = Object.values(SOURCE_GROUPS);
    expect(groups).toHaveLength(10);
    const total = groups.reduce((sum, g) => sum + g.budget, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("splits a multi-board operator's share inside its own group", () => {
    // LMArena publishes two boards; together they get 10%, not 20%.
    const metrics = listMetrics().filter((m) => m.groupId === "lmarena");
    expect(metrics).toHaveLength(2);
    expect(metrics.reduce((s, m) => s + m.budget, 0)).toBeCloseTo(0.1, 10);
    for (const m of metrics) expect(m.budget).toBeCloseTo(0.05, 10);
  });

  it("gives a single-board source its group's whole share", () => {
    const aa = listMetrics().find((m) => m.id === "aa");
    expect(aa.budget).toBeCloseTo(0.1, 10);
  });

  it("keeps every metric budget summing to 100%", () => {
    const total = listMetrics().reduce((sum, m) => sum + m.budget, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("holds each evidence family within the correlated-source cap", () => {
    // Related boards under different names must not jointly control the result.
    for (const [family, total] of Object.entries(familyTotals())) {
      expect(total, family).toBeLessThanOrEqual(FAMILY_CAP + 1e-9);
    }
  });
});

describe("pairwise results from a board", () => {
  it("records a win for the higher score and a loss for the lower", () => {
    const [r] = pairwiseFromBoard([e("a", 10), e("b", 5)], 0.1);
    expect(r.i).toBe("a");
    expect(r.j).toBe("b");
    expect(r.y).toBe(1);
  });

  it("records a draw when the board did not separate two models", () => {
    const [r] = pairwiseFromBoard([e("a", 7), e("b", 7)], 0.1);
    expect(r.y).toBe(0.5);
  });

  it("records a draw when published confidence intervals overlap", () => {
    // A gap the board itself calls noise must not become a win.
    const [r] = pairwiseFromBoard(
      [e("a", 1385, { ciLow: 1362, ciHigh: 1412 }), e("b", 1370, { ciLow: 1350, ciHigh: 1395 })],
      0.1,
    );
    expect(r.y).toBe(0.5);
  });

  it("still separates models whose intervals do not overlap", () => {
    const [r] = pairwiseFromBoard(
      [e("a", 1385, { ciLow: 1380, ciHigh: 1412 }), e("b", 1300, { ciLow: 1280, ciHigh: 1330 })],
      0.1,
    );
    expect(r.y).toBe(1);
  });

  it("gives a model the same total board budget regardless of field size", () => {
    // The whole point of dividing by (n-1): a long board must not outweigh a
    // short one just by containing more opponents.
    const short = pairwiseFromBoard([e("a", 3), e("b", 2), e("c", 1)], 0.1);
    const long = pairwiseFromBoard(
      Array.from({ length: 50 }, (_, i) => e(`m${i}`, i)),
      0.1,
    );

    const totalFor = (results, key) =>
      results.filter((r) => r.i === key || r.j === key).reduce((s, r) => s + r.w, 0);

    expect(totalFor(short, "a")).toBeCloseTo(FULL_EVIDENCE_BUDGET * 0.1, 6);
    expect(totalFor(long, "m0")).toBeCloseTo(FULL_EVIDENCE_BUDGET * 0.1, 6);
  });

  it("produces nothing from a board with fewer than two rated models", () => {
    expect(pairwiseFromBoard([e("a", 1)], 0.1)).toEqual([]);
    expect(pairwiseFromBoard([], 0.1)).toEqual([]);
    expect(pairwiseFromBoard(null, 0.1)).toEqual([]);
  });

  it("ignores unrated entries instead of scoring them as zero", () => {
    const results = pairwiseFromBoard([e("a", 5), e("b", null), e("c", 1)], 0.1);
    expect(results).toHaveLength(1);
    expect([results[0].i, results[0].j].sort()).toEqual(["a", "c"]);
  });
});

describe("Bradley-Terry fit", () => {
  it("orders models by who beat whom", () => {
    const results = [
      ...pairwiseFromBoard([e("strong", 3), e("mid", 2), e("weak", 1)], 0.1),
    ];
    const { abilities } = fitBradleyTerry(results);
    expect(abilities.get("strong")).toBeGreaterThan(abilities.get("mid"));
    expect(abilities.get("mid")).toBeGreaterThan(abilities.get("weak"));
  });

  it("converges", () => {
    const { converged } = fitBradleyTerry(
      pairwiseFromBoard([e("a", 3), e("b", 2), e("c", 1)], 0.1),
    );
    expect(converged).toBe(true);
  });

  it("keeps two models level when they only ever drew", () => {
    const results = pairwiseFromBoard([e("a", 5), e("b", 5)], 0.1);
    const { abilities } = fitBradleyTerry(results);
    expect(abilities.get("a")).toBeCloseTo(abilities.get("b"), 6);
  });

  it("never scores a model that was simply absent", () => {
    // "absent" appears on no board, so it must not appear in the fit at all.
    const { abilities } = fitBradleyTerry(pairwiseFromBoard([e("a", 2), e("b", 1)], 0.1));
    expect(abilities.has("absent")).toBe(false);
  });

  it("holds thin evidence closer to the prior than strong evidence", () => {
    // One weak board vs the same result seen across a lot of weight.
    const thin = fitBradleyTerry(pairwiseFromBoard([e("a", 2), e("b", 1)], 0.01));
    const strong = fitBradleyTerry(pairwiseFromBoard([e("a", 2), e("b", 1)], 1));
    expect(Math.abs(thin.abilities.get("a"))).toBeLessThan(Math.abs(strong.abilities.get("a")));
  });

  it("lets a consistent winner across boards outrank a one-board winner", () => {
    const results = [
      ...pairwiseFromBoard([e("broad", 3), e("narrow", 2), e("weak", 1)], 0.1),
      ...pairwiseFromBoard([e("broad", 3), e("weak", 1)], 0.1),
      ...pairwiseFromBoard([e("broad", 3), e("weak", 1)], 0.1),
    ];
    const { abilities } = fitBradleyTerry(results);
    expect(abilities.get("broad")).toBeGreaterThan(abilities.get("narrow"));
  });

  it("handles an empty comparison network", () => {
    const { abilities, converged } = fitBradleyTerry([]);
    expect(abilities.size).toBe(0);
    expect(converged).toBe(true);
  });
});

describe("anchored scoring", () => {
  it("puts a model level with its anchors at 50", () => {
    expect(scoreAgainstAnchors(0, [0, 0, 0])).toBeCloseTo(50, 6);
  });

  it("rises above 50 when stronger than the anchors and falls below when weaker", () => {
    expect(scoreAgainstAnchors(3, [0, 0])).toBeGreaterThan(90);
    expect(scoreAgainstAnchors(-3, [0, 0])).toBeLessThan(10);
  });

  it("stays inside 0-100", () => {
    expect(scoreAgainstAnchors(50, [0])).toBeLessThanOrEqual(100);
    expect(scoreAgainstAnchors(-50, [0])).toBeGreaterThanOrEqual(0);
  });

  it("is the mean predicted win rate over the anchors", () => {
    const expected = 100 * ((sigmoid(1 - 0) + sigmoid(1 - 2)) / 2);
    expect(scoreAgainstAnchors(1, [0, 2])).toBeCloseTo(expected, 9);
  });

  it("reports no score rather than a fake one when there are no anchors", () => {
    expect(scoreAgainstAnchors(1, [])).toBe(null);
    expect(scoreAgainstAnchors(1, null)).toBe(null);
  });
});
