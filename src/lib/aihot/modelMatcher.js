/**
 * Classify provider models against the aihot.news leaderboard catalog.
 *
 * Implements a three-way partition:
 * 1. "keep"      - Confirmed matches (on the leaderboard or user memory confirmed).
 * 2. "reject"    - Obvious non-matches ("一眼就能看出来不是排行榜上的模型" or user memory rejected).
 * 3. "uncertain" - Ambiguous models ("看不出来的") surfaced for user review.
 *
 * All user decisions are remembered in SQLite KV so they never need to be repeated.
 */

import { baseModelOf } from "@/lib/rankings/identity.js";
import { normalizeModelId, looseModelId, similarity, idVariants } from "@/lib/aa/match.js";

/** Obsolete, legacy, or low-tier model patterns that are definitively NOT on the current leaderboard */
const DEFINITE_REJECT_PATTERNS = [
  // Legacy OpenAI generations (leaderboard only features GPT-5.4+, GPT-5.5, GPT-5.6, GPT-6)
  /^gpt-(?:1|2|3|3\.5|3-5)/i,
  /^gpt-4(?!-5|-6|\.5|\.6)/i, // gpt-4, gpt-4-turbo, gpt-4o, gpt-4o-mini
  /^chatgpt-4o/i,
  /^o1-(?:preview|mini)/i,
  /^text-(?:davinci|curie|babbage|ada)/i,

  // Legacy Anthropic generations (leaderboard starts at Claude Opus 4.6 / Claude 5 family)
  /^claude-(?:1|2|instant)/i,
  /^claude-3-(?:opus|sonnet|haiku)/i,
  /^claude-3\.5-(?:sonnet|haiku)/i,
  /^claude-3-5-(?:sonnet|haiku)/i,

  // Legacy Google generations (leaderboard starts at Gemini 3.1 Pro / 3.5+ Flash / 4 Argon)
  /^gemini-(?:1|1\.0|1\.5|2|2\.0|2\.5)/i,
  /^gemini-pro(?!-3|-4)/i,
  /^gemini-flash(?!-3|-4)/i,
  /^(?:bison|gecko|chat-bison)/i,

  // Legacy DeepSeek generations (leaderboard features DeepSeek V4 / V4.1)
  /^deepseek-(?:chat|coder|llm|math|r1|v1|v2|v3)(?!-v4|-4)/i,

  // Legacy Qwen generations (leaderboard features Qwen 3.6, 3.7, 3.8)
  /^qwen-(?:1|1\.5|2|2\.5|7b|14b|32b|72b)(?!-3\.[6-8]|-3-[6-8])/i,
  /^qwen2\./i,

  // Legacy GLM generations (leaderboard features GLM 5.1, 5.2, 5.3)
  /^glm-(?:1|2|3|4)(?!-5|\.5)/i,
  /^chatglm/i,

  // Open-source families not listed on the aihot leaderboard
  /^llama-(?:1|2|3|3\.1|3\.2|3\.3)/i,
  /^codellama/i,
  /^gemma-(?:1|2|7b|2b|9b|27b)/i,
  /^phi-(?:1|2|3|3\.5|4)/i,
  /^mistral-(?:7b|tiny|small|large)/i,
  /^mixtral-(?:8x7b|8x22b)/i,
  /^yi-(?:6b|9b|34b|large)/i,
  /^baichuan/i,
  /^internlm/i,
  /^openpangu/i,
  /^agnes-(?:1|2)/i,
  /^minimax-(?:01|abab5|abab6)/i,

  // Utility / Non-LLM / Embeddings
  /^(?:text-embedding|bge-|e5-|gte-|voyage-|cohere-embed|embed)/i,
  /^(?:whisper|tts|stt|dall-e|flux|stable-diffusion|sdxl|midjourney|playground)/i,
  /^(?:test|dummy|echo|mock)$/i,
];

/**
 * Active model families present on the current leaderboard.
 * If a model belongs to one of these families and is NOT explicitly obsolete,
 * but cannot be matched 100%, it should be treated as uncertain for user review.
 */
const LEADERBOARD_FAMILIES = [
  "claude",
  "gpt",
  "gemini",
  "deepseek",
  "qwen",
  "glm",
  "grok",
  "muse",
  "kimi",
  "mimo",
  "minimax",
  "mistral",
  "step",
  "ling",
  "inkling",
  "ember",
  "nemotron",
];

/** Thresholds for classification */
const MATCH_HIGH_CONFIDENCE = 0.88;
const UNCERTAIN_MIN_SIMILARITY = 0.35;

/** Tokenize splitting words and digits e.g. "v4-turbo" -> ["v", "4", "turbo"] */
function deepTokenize(str) {
  const norm = normalizeModelId(str);
  // Split on hyphens, then split letter/digit boundaries
  const parts = norm.split("-").filter(Boolean);
  const tokens = new Set();
  for (const part of parts) {
    tokens.add(part);
    // Also split letter followed by digit or digit followed by letter (e.g. v4 -> v, 4)
    const sub = part.replace(/([a-zA-Z])(\d)/g, "$1 $2").replace(/(\d)([a-zA-Z])/g, "$1 $2").split(" ");
    for (const s of sub) {
      if (s) tokens.add(s.toLowerCase());
    }
  }
  return tokens;
}

/** Compute token similarity splitting word-digit boundaries */
function deepSimilarity(a, b) {
  const setA = deepTokenize(a);
  const setB = deepTokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared += 1;
  }
  return shared / (setA.size + setB.size - shared);
}

/**
 * Check if model belongs to an active leaderboard family.
 */
function getLeaderboardFamily(id) {
  const norm = normalizeModelId(id).toLowerCase();
  for (const fam of LEADERBOARD_FAMILIES) {
    if (norm.startsWith(fam) || norm.includes(`-${fam}-`) || norm.includes(`-${fam}`) || norm.startsWith(`${fam}-`)) {
      return fam;
    }
  }
  return null;
}

/**
 * Build lookup indexes from the aihot leaderboard catalog.
 * @param {Array<{slug: string, name: string, rawAliases?: string[], categories?: string[]}>} catalog
 */
export function buildLeaderboardIndex(catalog = []) {
  const byExactSlug = new Map();
  const byNormalized = new Map();
  const byBase = new Map();
  const allAliasesList = [];

  for (const item of catalog || []) {
    if (!item?.slug) continue;
    const slug = String(item.slug).trim().toLowerCase();
    byExactSlug.set(slug, item);

    const normSlug = normalizeModelId(slug);
    if (normSlug && !byNormalized.has(normSlug)) {
      byNormalized.set(normSlug, item);
    }

    const baseSlug = normalizeModelId(baseModelOf(slug));
    if (baseSlug && !byBase.has(baseSlug)) {
      byBase.set(baseSlug, item);
    }

    allAliasesList.push({ key: normSlug, base: baseSlug, raw: slug, item });

    // Index display name
    if (item.name) {
      const normName = normalizeModelId(item.name);
      if (normName && !byNormalized.has(normName)) {
        byNormalized.set(normName, item);
      }
      allAliasesList.push({ key: normName, base: normalizeModelId(baseModelOf(item.name)), raw: item.name, item });
    }

    // Index raw aliases from sub-boards
    for (const alias of item.rawAliases || []) {
      const normAlias = normalizeModelId(alias);
      if (normAlias && !byNormalized.has(normAlias)) {
        byNormalized.set(normAlias, item);
      }
      const baseAlias = normalizeModelId(baseModelOf(alias));
      if (baseAlias && !byBase.has(baseAlias)) {
        byBase.set(baseAlias, item);
      }
      allAliasesList.push({ key: normAlias, base: baseAlias, raw: alias, item });
    }
  }

  return {
    byExactSlug,
    byNormalized,
    byBase,
    allAliasesList,
    totalCount: catalog.length,
  };
}

/**
 * Normalize an arbitrary provider model string to testable candidate keys.
 * Handles prefixes (e.g. `pollinations/chigwell/gpt-5.6-terra` -> `gpt-5-6-terra`).
 */
export function extractCandidateKeys(modelId) {
  const raw = String(modelId || "").trim();
  // Strip provider or namespace prefix if present (e.g. "openai-compatible-.../model" or "org/model")
  let clean = raw;
  if (clean.includes("/")) {
    clean = clean.split("/").pop();
  }

  const norm = normalizeModelId(clean);
  const loose = looseModelId(clean);
  const base = normalizeModelId(baseModelOf(clean));
  const variants = idVariants(clean);

  return {
    raw,
    clean,
    norm,
    loose,
    base,
    variants,
  };
}

/**
 * Check if a model is an obvious, unmistakable non-match.
 * @param {string} cleanId - Model ID without namespace prefix
 * @returns {boolean}
 */
export function isObviousNonMatch(cleanId) {
  const normalized = normalizeModelId(cleanId);
  for (const pattern of DEFINITE_REJECT_PATTERNS) {
    if (pattern.test(cleanId) || pattern.test(normalized)) {
      return true;
    }
  }
  return false;
}

/**
 * Match a single model against the leaderboard index.
 *
 * @param {string} modelId - Full or bare model id from provider
 * @param {ReturnType<buildLeaderboardIndex>} index
 * @param {Object} [filterDecisions={}] - User's remembered decisions
 * @returns {{
 *   status: "keep" | "reject" | "uncertain",
 *   reason: string,
 *   matchedModel: object|null,
 *   candidate: object|null,
 *   score: number
 * }}
 */
export function classifyModel(modelId, index, filterDecisions = {}) {
  const { raw, clean, norm, loose, base, variants } = extractCandidateKeys(modelId);

  // 1. Fresh Leaderboard Check (highest authority):
  // If a model is currently on the official aihot.news leaderboard (main or category sub-boards),
  // it is ALWAYS kept, even if it was previously filtered out or rejected!
  // This ensures that when aihot.news updates and adds a previously-omitted model,
  // it is automatically resurrected into the whitelist.
  const exactSlugMatch = index.byExactSlug.get(clean.toLowerCase()) || index.byExactSlug.get(raw.toLowerCase());
  if (exactSlugMatch) {
    return {
      status: "keep",
      reason: "exact_slug_match",
      matchedModel: exactSlugMatch,
      candidate: null,
      score: 1.0,
    };
  }

  const normMatch = index.byNormalized.get(norm);
  if (normMatch) {
    return {
      status: "keep",
      reason: "normalized_match",
      matchedModel: normMatch,
      candidate: null,
      score: 1.0,
    };
  }

  // Check ID variants (split/joined numbers like qwen-3-8 vs qwen3.8)
  for (const v of variants) {
    const vMatch = index.byNormalized.get(v) || index.byBase.get(v);
    if (vMatch) {
      return {
        status: "keep",
        reason: "variant_match",
        matchedModel: vMatch,
        candidate: null,
        score: 0.98,
      };
    }
  }

  // Check loose/base model match (stripping effort/thinking/quantization tags)
  const baseMatch = index.byBase.get(base) || (loose && index.byBase.get(loose));
  if (baseMatch) {
    return {
      status: "keep",
      reason: "base_model_match",
      matchedModel: baseMatch,
      candidate: null,
      score: 0.95,
    };
  }

  // 2. Check persistent user memory:
  // If a model is not directly on the leaderboard, check if the user previously
  // explicitly decided to keep or reject this specific variant.
  const remembered =
    filterDecisions[raw] ||
    filterDecisions[clean] ||
    filterDecisions[norm] ||
    filterDecisions[base];

  if (remembered) {
    const decision = typeof remembered === "string" ? remembered : remembered.decision;
    if (decision === "keep") {
      return {
        status: "keep",
        reason: "remembered_user_keep",
        matchedModel: index.byNormalized.get(norm) || index.byBase.get(base) || null,
        candidate: null,
        score: 1.0,
      };
    }
    if (decision === "reject") {
      return {
        status: "reject",
        reason: "remembered_user_reject",
        matchedModel: null,
        candidate: null,
        score: 0.0,
      };
    }
  }

  // 3. Check for obvious non-matches
  if (isObviousNonMatch(clean)) {
    return {
      status: "reject",
      reason: "obvious_legacy_or_unranked_family",
      matchedModel: null,
      candidate: null,
      score: 0.0,
    };
  }

  // 4. Similarity scan against all leaderboard aliases
  let bestCandidate = null;
  let bestScore = 0;

  for (const entry of index.allAliasesList) {
    const s1 = similarity(norm, entry.key);
    const s2 = entry.base ? similarity(base, entry.base) : 0;
    const s3 = deepSimilarity(norm, entry.key);
    const score = Math.max(s1, s2, s3);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = entry.item;
    }
  }

  // High similarity -> keep
  if (bestCandidate && bestScore >= MATCH_HIGH_CONFIDENCE) {
    return {
      status: "keep",
      reason: "high_similarity_match",
      matchedModel: bestCandidate,
      candidate: null,
      score: bestScore,
    };
  }

  // If model belongs to an active leaderboard family (e.g. deepseek, qwen, glm, gpt, etc.)
  // and wasn't caught by the legacy reject list, it is a non-standard or custom variant
  // -> mark as uncertain so user can decide!
  const family = getLeaderboardFamily(clean) || getLeaderboardFamily(raw);
  if (family) {
    return {
      status: "uncertain",
      reason: `family_variant_needs_review (${family})`,
      matchedModel: null,
      candidate: bestCandidate
        ? {
            slug: bestCandidate.slug,
            name: bestCandidate.name,
          }
        : null,
      score: bestScore,
    };
  }

  // Low similarity (< 0.35) and not in a leaderboard family -> reject
  if (bestScore < UNCERTAIN_MIN_SIMILARITY) {
    return {
      status: "reject",
      reason: "low_similarity_not_on_leaderboard",
      matchedModel: null,
      candidate: null,
      score: bestScore,
    };
  }

  // Moderate similarity -> uncertain
  return {
    status: "uncertain",
    reason: "ambiguous_needs_review",
    matchedModel: null,
    candidate: bestCandidate
      ? {
          slug: bestCandidate.slug,
          name: bestCandidate.name,
        }
      : null,
    score: bestScore,
  };

  // 5. Ambiguous / Uncertain -> Surface for user decision!
  return {
    status: "uncertain",
    reason: "ambiguous_needs_review",
    matchedModel: null,
    candidate: bestCandidate
      ? {
          slug: bestCandidate.slug,
          name: bestCandidate.name,
        }
      : null,
    score: bestScore,
  };
}

/**
 * Filter and partition a list of provider models.
 *
 * @param {Array<{id: string, name?: string}>} models
 * @param {ReturnType<buildLeaderboardIndex>} index
 * @param {Object} filterDecisions
 * @returns {{
 *   keep: Array,
 *   reject: Array,
 *   uncertain: Array
 * }}
 */
export function partitionProviderModels(models = [], index, filterDecisions = {}) {
  const keep = [];
  const reject = [];
  const uncertain = [];

  for (const m of models) {
    const rawId = typeof m === "string" ? m : m.id || m.name;
    if (!rawId) continue;
    const classified = classifyModel(rawId, index, filterDecisions);

    const modelObj = typeof m === "object" ? { ...m } : { id: m, name: m };

    if (classified.status === "keep") {
      keep.push({
        ...modelObj,
        _match: {
          reason: classified.reason,
          leaderboardSlug: classified.matchedModel?.slug || null,
        },
      });
    } else if (classified.status === "reject") {
      reject.push({
        ...modelObj,
        _reject: {
          reason: classified.reason,
          score: classified.score,
        },
      });
    } else {
      uncertain.push({
        ...modelObj,
        _review: {
          candidate: classified.candidate,
          score: classified.score,
          reason: classified.reason,
        },
      });
    }
  }

  return { keep, reject, uncertain };
}
