/**
 * Weighted, regularized Bradley-Terry estimation over pairwise results.
 *
 * Why pairwise rather than averaging board scores: leaderboards evaluate
 * different model populations on different scales. Averaging percentiles asks
 * "how did this model do against everyone that board happened to test", so a
 * board full of weak models flatters whoever appears on it. A win/loss recorded
 * only between two models that BOTH sat the same test is immune to that — the
 * comparison exists or it does not.
 *
 * Absence is therefore never evidence. A model missing from a board produces no
 * result there; it is not a loss, not a draw, and not a zero. It only means less
 * evidence, which shows up as lower coverage and a wider standard error.
 *
 *   P(i beats j) = 1 / (1 + e^-(sᵢ - sⱼ))
 *
 * Fitted by minimising the weighted log-loss plus a zero-centred Gaussian prior.
 * The prior matters only where evidence is thin: with one or two comparisons the
 * likelihood alone would happily run a model's ability off to ±∞.
 */

/** Effective comparison budget of a model covered by every source. */
export const FULL_EVIDENCE_BUDGET = 84;

const DEFAULT_OPTIONS = {
  prior: 0.5,        // Gaussian prior precision; weak, only binds on thin evidence
  maxIterations: 500,
  tolerance: 1e-7,
  learningRate: 0.5,
};

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * Build weighted pairwise results from one board's scores.
 *
 * Every pair of co-evaluated models yields one result. Two models are a draw
 * when the board did not actually separate them: identical scores, or — where
 * the board publishes confidence intervals — overlapping intervals. Recording a
 * win off a difference the board itself calls noise would manufacture evidence.
 *
 * The weight divides by (participants - 1) so a model's total evidence from one
 * board is the board's budget regardless of how many opponents it happened to
 * face — otherwise a 500-model board would swamp a 40-model one purely on
 * volume, which is exactly the single-source dominance this is meant to avoid.
 *
 * @param {Array<{key:string, score:number, ciLow?:number, ciHigh?:number}>} entries
 * @param {number} budget - this metric's share of the total evidence budget (0-1)
 * @param {number} [tolerance] - score gap under which two models are a draw
 * @returns {Array<{i:string, j:string, y:number, w:number}>}
 */
export function pairwiseFromBoard(entries, budget, tolerance = 0) {
  const rated = (entries || []).filter(
    (e) => e && e.key && typeof e.score === "number" && Number.isFinite(e.score),
  );
  const n = rated.length;
  if (n < 2) return [];

  const weight = (FULL_EVIDENCE_BUDGET * budget) / (n - 1);
  const results = [];

  const hasCi = (e) => Number.isFinite(e.ciLow) && Number.isFinite(e.ciHigh);
  const overlaps = (a, b) => hasCi(a) && hasCi(b) && a.ciLow <= b.ciHigh && b.ciLow <= a.ciHigh;

  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      const diff = rated[a].score - rated[b].score;
      let y;
      if (Math.abs(diff) <= tolerance || overlaps(rated[a], rated[b])) y = 0.5;
      else y = diff > 0 ? 1 : 0;
      results.push({ i: rated[a].key, j: rated[b].key, y, w: weight });
    }
  }

  return results;
}

/**
 * Fit latent abilities from weighted pairwise results.
 *
 * @param {Array<{i:string, j:string, y:number, w:number}>} results
 * @param {Object} [options]
 * @returns {{abilities: Map<string, number>, iterations: number, converged: boolean}}
 */
export function fitBradleyTerry(results, options = {}) {
  const { prior, maxIterations, tolerance, learningRate } = { ...DEFAULT_OPTIONS, ...options };
  const list = Array.isArray(results) ? results : [];

  const keys = [...new Set(list.flatMap((r) => [r.i, r.j]))];
  const index = new Map(keys.map((key, i) => [key, i]));
  const abilities = new Float64Array(keys.length);

  if (keys.length === 0) {
    return { abilities: new Map(), iterations: 0, converged: true };
  }

  // Total weight per model sets a per-model step scale: a model with one thin
  // comparison must not take the same size step as one with hundreds.
  const totalWeight = new Float64Array(keys.length);
  for (const r of list) {
    totalWeight[index.get(r.i)] += r.w;
    totalWeight[index.get(r.j)] += r.w;
  }

  const gradient = new Float64Array(keys.length);
  let iterations = 0;
  let converged = false;

  for (; iterations < maxIterations; iterations += 1) {
    gradient.fill(0);

    for (const r of list) {
      const a = index.get(r.i);
      const b = index.get(r.j);
      const p = sigmoid(abilities[a] - abilities[b]);
      const residual = r.w * (p - r.y);
      gradient[a] += residual;
      gradient[b] -= residual;
    }

    let maxStep = 0;
    for (let k = 0; k < keys.length; k += 1) {
      gradient[k] += prior * abilities[k];
      // Newton-ish scaling: the log-loss curvature is bounded by w/4 per match.
      const scale = learningRate / (totalWeight[k] / 4 + prior);
      const step = scale * gradient[k];
      abilities[k] -= step;
      if (Math.abs(step) > maxStep) maxStep = Math.abs(step);
    }

    if (maxStep < tolerance) {
      converged = true;
      iterations += 1;
      break;
    }
  }

  return {
    abilities: new Map(keys.map((key, i) => [key, abilities[i]])),
    iterations,
    converged,
  };
}

/**
 * Map latent ability to a 0-100 score against a frozen anchor set.
 *
 * Anchors define the ruler and nothing else — they contribute no extra wins and
 * no extra source weight. Scoring against fixed anchors rather than the current
 * population is what stops the scale from breathing every time a new model is
 * added or an old one retired.
 *
 *   Score(i) = 100/|A| × Σ P(i beats a)
 *
 * @param {number} ability
 * @param {number[]} anchorAbilities
 * @returns {number|null} null when there are no anchors to measure against
 */
export function scoreAgainstAnchors(ability, anchorAbilities) {
  const anchors = (anchorAbilities || []).filter((a) => typeof a === "number" && Number.isFinite(a));
  if (anchors.length === 0) return null;
  const total = anchors.reduce((sum, a) => sum + sigmoid(ability - a), 0);
  return (100 / anchors.length) * total;
}

export { sigmoid };
