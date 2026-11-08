/**
 * Consensus ranking across multiple leaderboards.
 *
 * Ordering a combo by one leaderboard inherits that leaderboard's bias: its
 * benchmark mix, its scoring harness, and whatever it chose not to evaluate.
 *
 * The aggregation deliberately does NOT average board scores or percentiles.
 * Boards test different populations on incomparable scales, so an average asks
 * "how did this model do against whoever that board happened to include" — a
 * board full of weak models flatters everyone on it. Instead each board yields
 * win/loss/draw results only between models that BOTH sat it, and one weighted
 * Bradley-Terry fit over the whole comparison network estimates latent ability.
 *
 * Consequences worth stating, because they are the point:
 *  - A model missing from a board gets no result there. Not a zero, not a loss.
 *  - Vacant budget is never handed to the sources that did report.
 *  - Thin evidence shows up as low coverage, not as a lower score.
 *  - Scores are anchored, so adding or retiring models does not rescale everyone.
 */

import { normalizeModelId } from "@/lib/aa/match";
import { listMetrics, SOURCE_GROUPS } from "./budget";
import { baseModelOf, selectRepresentatives } from "./identity";
import { pairwiseFromBoard, fitBradleyTerry, scoreAgainstAnchors, FULL_EVIDENCE_BUDGET } from "./bradleyTerry";

/**
 * The join key across sources.
 *
 * Keyed on the BASE model, because that is the ranking subject: a reasoning tier
 * or harness is an evaluation configuration, not a different model, and keying
 * on the decorated slug means `claude-fable-5-max-effort` from one board never
 * joins `claude-fable-5` from another. Strict normalisation on top absorbs
 * vendor prefixes and release stamps, so `openai/gpt-4o` and
 * `gpt-4o-2024-08-06` also land together.
 */
function joinKey(entry) {
  return normalizeModelId(baseModelOf(entry.slug));
}

/**
 * Anchor models — a frozen ruler spanning the ability range.
 *
 * Fixed rather than derived from the current population: if anchors moved with
 * the field, every model's score would drift whenever a new release landed, and
 * two snapshots would not be comparable. Missing anchors are skipped, so this
 * degrades rather than breaks as models age out.
 */
export const ANCHOR_MODELS = [
  "claude-opus-5", "gpt-5-6-sol", "claude-fable-5", "kimi-k3", "gpt-5-5",
  "claude-opus-4-8", "qwen3-8-max", "gemini-3-5-flash", "grok-4-5", "claude-sonnet-5",
  "deepseek-v4-pro", "glm-5-2", "gpt-5-4", "gemini-3-pro", "minimax-m3",
  "kimi-k2-6", "mistral-medium-3-5", "llama-4-maverick",
];

/** Minimum anchors that must resolve before scores are published. */
const MIN_ANCHORS = 8;

/**
 * Merge leaderboards into one catalog carrying a consensus score.
 *
 * @param {Array<{id:string, models:Array<{slug,name,creator,score,metrics}>}>} boards
 *   One entry per METRIC (a two-board operator supplies two), keyed by metric id
 *   from budget.js. Unknown ids are ignored rather than silently given weight.
 * @returns {{models:Array, sources:Array, comparisons:number, anchorsUsed:number}}
 */
export function buildComposite(boards) {
  const metricsById = new Map(listMetrics().map((m) => [m.id, m]));

  const supplied = (boards || []).filter(
    (b) => b && metricsById.has(b.id) && Array.isArray(b.models) && b.models.length > 0,
  );

  // key -> catalog record
  const records = new Map();
  // key -> accumulated evidence budget (coverage)
  const coverage = new Map();
  const results = [];
  const ratedBy = new Map();

  for (const board of supplied) {
    const metric = metricsById.get(board.id);
    const entries = [];

    // One representative configuration per base model, chosen by fixed priority
    // before any score is read — otherwise a model could be represented by
    // whichever tier happened to score best, and vendors publishing many tiers
    // would be rewarded for it.
    for (const entry of selectRepresentatives(board.models)) {
      const key = joinKey(entry);
      if (!key) continue;
      if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) continue;

      if (!records.has(key)) {
        records.set(key, {
          slug: entry.slug,
          name: entry.name || entry.slug,
          creator: entry.creator || null,
          sourceScores: {},
          ...entry.metrics,
        });
      }
      const record = records.get(key);
      record.sourceScores[board.id] = entry.score;
      if (entry.metrics) {
        for (const [name, value] of Object.entries(entry.metrics)) {
          if (record[name] === undefined || record[name] === null) record[name] = value;
        }
      }
      if (!record.creator && entry.creator) record.creator = entry.creator;
      if (entry.openrouterApiId && !record.openrouterApiId) record.openrouterApiId = entry.openrouterApiId;

      // Coverage accrues the metric's budget for every board actually sat.
      coverage.set(key, (coverage.get(key) || 0) + metric.budget);
      if (!ratedBy.has(key)) ratedBy.set(key, new Set());
      ratedBy.get(key).add(metric.groupId);

      entries.push({ key, score: entry.score, ciLow: entry.ciLow, ciHigh: entry.ciHigh });
    }

    // Appended in a loop, not spread: a 600-model board yields ~180k pairs, and
    // `push(...pairs)` passes every one as an argument, which overflows the stack.
    for (const pair of pairwiseFromBoard(entries, metric.budget)) results.push(pair);
  }

  if (records.size === 0) {
    return { models: [], sources: [], comparisons: 0, anchorsUsed: 0 };
  }

  const { abilities } = fitBradleyTerry(results);

  // Resolve anchors against the fitted abilities; they set the scale only.
  const anchorAbilities = ANCHOR_MODELS
    .map((slug) => abilities.get(normalizeModelId(slug)))
    .filter((a) => typeof a === "number" && Number.isFinite(a));
  const canScore = anchorAbilities.length >= MIN_ANCHORS;

  const models = [...records.entries()].map(([key, record]) => {
    const ability = abilities.get(key) ?? 0;
    const groups = ratedBy.get(key) || new Set();
    return {
      ...record,
      ability,
      // Falls back to the ability ordering when too few anchors resolve: the
      // ranking is still valid, only the 0-100 scale is unavailable.
      compositeScore: canScore ? scoreAgainstAnchors(ability, anchorAbilities) : null,
      coverage: coverage.get(key) || 0,
      evidenceFamilies: new Set([...groups].map((g) => SOURCE_GROUPS[g]?.family).filter(Boolean)).size,
      ratedBy: [...groups],
    };
  });

  return {
    models,
    sources: supplied.map((board) => ({
      id: board.id,
      groupId: metricsById.get(board.id).groupId,
      label: metricsById.get(board.id).label,
      budget: metricsById.get(board.id).budget,
      family: metricsById.get(board.id).family,
      count: board.models.length,
    })),
    comparisons: results.length,
    anchorsUsed: anchorAbilities.length,
  };
}

export { FULL_EVIDENCE_BUDGET };
