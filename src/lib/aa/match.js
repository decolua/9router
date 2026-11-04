/**
 * Map 9Router `provider/model` ids onto Artificial Analysis records.
 *
 * Three tiers, strongest evidence first. Anything that clears none of them is
 * returned as unmatched rather than force-fitted — a wrong match silently
 * reorders a combo, which is worse than an visible gap the user can bind by hand.
 */

const FUZZY_THRESHOLD = 0.8;

/** Trailing release stamps: -20250929, -2025-09-29, -250929. */
const DATE_SUFFIX = /-(?:\d{8}|\d{4}-\d{2}-\d{2}|\d{6})$/;
/** Vendor decorations that never distinguish two real models. */
const NOISE_SUFFIXES = ["-latest", "-preview", "-stable", "-v1", "-001", "-002"];

/**
 * Serving details and effort levels that a provider appends to the same
 * underlying model. Stripped only in the loose pass, so they can never weaken an
 * exact match: `claude-opus-5-high` still matches AA's own `-high` entry first.
 *
 * Kept in step with the configuration suffixes in `@/lib/rankings/identity`: the
 * merged catalog is keyed on base models, so the loose pass has to be able to
 * reach that same form or catalog entries become unmatchable from a provider id.
 */
const LOOSE_SUFFIXES = [
  "-fp8-fast", "-fp8", "-int8", "-int4", "-awq", "-gptq", "-bf16",
  "-instruct", "-chat", "-it", "-agent",
  "-extra-low", "-xhigh", "-minimal", "-low", "-medium", "-high",
  "-max-effort", "-max", "-none", "-thinking", "-non-reasoning", "-reasoning",
  "-review", "-base",
];

/**
 * Family-token variants of an id.
 *
 * Providers disagree on whether the family digit is attached (`qwen3-32b`) or
 * separated (`qwen-3-32b`), and a leaderboard may publish either. Returned as
 * EXTRA candidate keys rather than a replacement, so this can only add matches,
 * never redirect one that already worked.
 */
export function idVariants(value) {
  const base = normalizeModelId(value);
  if (!base) return [];
  const variants = new Set([base]);

  // qwen-3-32b -> qwen3-32b
  const joined = base.replace(/^([a-z]+)-(\d)/, "$1$2");
  if (joined !== base) variants.add(joined);
  // qwen3-32b -> qwen-3-32b
  const split = base.replace(/^([a-z]+)(\d)/, "$1-$2");
  if (split !== base) variants.add(split);
  // Vendor decorations some routers prepend: zai-glm-4.7 -> glm-4.7
  const deprefixed = base.replace(/^(?:zai|ali|bytedance|volc|ms|az)-/, "");
  if (deprefixed !== base && deprefixed.length > 3) variants.add(deprefixed);

  return [...variants];
}

/**
 * Canonical form for comparison: lowercase, vendor prefix dropped, separators
 * unified, release stamps and vendor decorations removed.
 */
export function normalizeModelId(value) {
  let id = String(value || "").toLowerCase().trim();
  if (!id) return "";
  if (id.includes("/")) id = id.split("/").pop();
  id = id.replace(/[._\s]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  id = id.replace(DATE_SUFFIX, "");
  for (const suffix of NOISE_SUFFIXES) {
    if (id.endsWith(suffix)) id = id.slice(0, -suffix.length);
  }
  return id.replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

/**
 * Looser canonical form: also drops quantization / serving / effort suffixes so
 * `llama-3.3-70b-instruct-fp8-fast` reaches `llama-3.3-70b`. Applied repeatedly
 * because providers stack them.
 */
export function looseModelId(value) {
  let id = normalizeModelId(value);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LOOSE_SUFFIXES) {
      if (id.endsWith(suffix) && id.length > suffix.length) {
        id = id.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return id;
}

function tokenize(id) {
  return new Set(normalizeModelId(id).split("-").filter(Boolean));
}

/** Jaccard similarity over hyphen-separated tokens. */
export function similarity(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

/**
 * Build lookup indexes once so matching many models stays linear-ish.
 * @param {Array} aaModels - normalized AA records
 */
export function buildIndex(aaModels) {
  const bySlug = new Map();
  const byOpenRouter = new Map();
  const byLoose = new Map();
  const list = Array.isArray(aaModels) ? aaModels : [];

  for (const model of list) {
    const slugKey = normalizeModelId(model.slug);
    if (slugKey && !bySlug.has(slugKey)) bySlug.set(slugKey, model);
    if (model.openrouterApiId) {
      const orKey = normalizeModelId(model.openrouterApiId);
      if (orKey && !byOpenRouter.has(orKey)) byOpenRouter.set(orKey, model);
    }
    for (const looseKey of [looseModelId(model.slug), model.openrouterApiId ? looseModelId(model.openrouterApiId) : ""]) {
      if (looseKey && !byLoose.has(looseKey)) byLoose.set(looseKey, model);
    }
  }

  return { bySlug, byOpenRouter, byLoose, list };
}

/**
 * Match one 9Router model string.
 * @param {string} modelStr - "provider/model" or bare model id
 * @param {ReturnType<buildIndex>} index
 * @returns {{model: object|null, confidence: "exact-openrouter"|"exact-slug"|"fuzzy"|"none", score: number}}
 */
export function matchModel(modelStr, index, { fuzzy = true } = {}) {
  const key = normalizeModelId(modelStr);
  if (!key) return { model: null, confidence: "none", score: 0 };

  const viaOpenRouter = index.byOpenRouter.get(key);
  if (viaOpenRouter) return { model: viaOpenRouter, confidence: "exact-openrouter", score: 1 };

  const viaSlug = index.bySlug.get(key);
  if (viaSlug) return { model: viaSlug, confidence: "exact-slug", score: 1 };

  // Family-token spellings differ between providers and leaderboards
  // (`qwen-3-32b` vs `qwen3-32b`); try those before falling back to fuzzy.
  for (const variant of idVariants(modelStr)) {
    if (variant === key) continue;
    const viaVariant = index.bySlug.get(variant) || index.byOpenRouter.get(variant);
    if (viaVariant) return { model: viaVariant, confidence: "variant", score: 0.98 };
  }

  const looseKey = looseModelId(modelStr);
  const viaLoose = looseKey && looseKey !== key ? index.byLoose?.get(looseKey) : index.byLoose?.get(key);
  if (viaLoose) return { model: viaLoose, confidence: "loose", score: 0.95 };

  // A loose form may also need the family-token fix to land.
  if (looseKey) {
    for (const variant of idVariants(looseKey)) {
      const viaLooseVariant = index.byLoose?.get(variant) || index.bySlug.get(variant);
      if (viaLooseVariant) return { model: viaLooseVariant, confidence: "loose", score: 0.93 };
    }
  }

  // The fuzzy pass scans every candidate, so bulk callers (whole-catalog
  // listings) opt out and accept the exact/loose hit rate instead.
  if (!fuzzy) return { model: null, confidence: "none", score: 0 };

  let best = null;
  let bestScore = 0;
  for (const candidate of index.list) {
    const score = Math.max(
      similarity(key, candidate.slug),
      candidate.openrouterApiId ? similarity(key, candidate.openrouterApiId) : 0
    );
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best && bestScore >= FUZZY_THRESHOLD) {
    return { model: best, confidence: "fuzzy", score: bestScore };
  }
  return { model: null, confidence: "none", score: bestScore };
}

/**
 * Best-scoring candidates for a model that cleared no matching tier.
 *
 * Exists because the leaderboard often benchmarks named variants without the
 * plain family id — `gpt-5.6` has no entry, only `gpt-5-6-sol`, `-luna` and
 * `-terra`, which are genuinely different models. The top candidate is applied
 * as a provisional binding (see `autoBindUnmatched`) so the user reviews an
 * already-ordered list instead of resolving every gap by hand, and the full
 * shortlist stays available to correct it.
 */
export function topCandidates(modelStr, index, limit = 5) {
  const key = normalizeModelId(modelStr);
  if (!key) return [];
  return index.list
    .map((candidate) => ({
      slug: candidate.slug,
      name: candidate.name,
      creator: candidate.creator,
      score: Math.max(
        similarity(key, candidate.slug),
        candidate.openrouterApiId ? similarity(key, candidate.openrouterApiId) : 0
      ),
    }))
    .filter((c) => c.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Provisionally bind each unmatched model to its closest leaderboard entry.
 *
 * Leaving every gap unranked made the user resolve them one dropdown at a time
 * before the ordering was usable. Guessing is acceptable here precisely because
 * it is reviewable: each auto-binding is reported separately from a confirmed
 * match so the UI can flag it, and any explicit user decision wins.
 *
 * `userBindings` uses key presence as intent: a key mapped to an empty string
 * means "I looked at this and want it left unranked", which must survive a
 * re-rank rather than being auto-bound again on the next pass.
 *
 * @param {string[]} unmatched
 * @param {ReturnType<buildIndex>} index
 * @param {Object<string,string>} userBindings
 * @returns {{bindings: Object<string,string>, suggestions: Object<string,Array>}}
 */
export function autoBindUnmatched(unmatched, index, userBindings = {}) {
  const bindings = {};
  const suggestions = {};

  for (const modelStr of unmatched || []) {
    const candidates = topCandidates(modelStr, index);
    if (candidates.length > 0) suggestions[modelStr] = candidates;

    // An explicit decision — including "leave unranked" — is never overridden.
    if (Object.prototype.hasOwnProperty.call(userBindings, modelStr)) continue;
    if (candidates.length > 0) bindings[modelStr] = candidates[0].slug;
  }

  return { bindings, suggestions };
}

/**
 * Match a whole combo's model list.
 * @returns {{matched: Array, unmatched: string[]}} unmatched preserves input order
 */
export function matchModels(modelStrs, aaModels, manualBindings = {}, options = {}) {
  const index = buildIndex(aaModels);
  const matched = [];
  const unmatched = [];

  for (const modelStr of Array.isArray(modelStrs) ? modelStrs : []) {
    const boundSlug = manualBindings[modelStr];
    if (boundSlug) {
      const bound = index.bySlug.get(normalizeModelId(boundSlug));
      if (bound) {
        matched.push({ modelStr, aa: bound, confidence: "manual", score: 1 });
        continue;
      }
    }
    const { model, confidence, score } = matchModel(modelStr, index, options);
    if (model) matched.push({ modelStr, aa: model, confidence, score });
    else unmatched.push(modelStr);
  }

  return { matched, unmatched };
}
