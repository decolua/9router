/**
 * Service to fetch and parse Artificial Analysis LLM Leaderboard models
 * URL: https://artificialanalysis.ai/leaderboards/models
 */

let cachedLeaderboard = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
// Rate-limit forced refreshes (create/edit/manual/scheduled) so repeated
// dashboard actions or spam cannot hammer artificialanalysis.ai.
const MIN_FORCE_INTERVAL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 15 * 1000;
const MAX_HTML_BYTES = 20 * 1024 * 1024;
let lastForceFetchTime = 0;

// Provider alias/ID to creator name mapping
const CREATOR_ALIASES = {
  openai: ["OpenAI", "openai"],
  cx: ["OpenAI", "openai"],
  codex: ["OpenAI", "openai"],
  gh: ["OpenAI", "openai", "GitHub"],
  anthropic: ["Anthropic", "anthropic"],
  cc: ["Anthropic", "anthropic"],
  cl: ["Anthropic", "Google", "DeepSeek", "Meta", "Mistral", "xAI"],
  kiro: ["Anthropic", "anthropic", "Amazon", "Kiro"],
  kr: ["Anthropic", "OpenAI", "Google"],
  google: ["Google", "google"],
  gemini: ["Google", "google"],
  gc: ["Google", "google"],
  ag: ["Google", "Anthropic"],
  deepseek: ["DeepSeek", "deepseek"],
  ds: ["DeepSeek", "deepseek"],
  groq: ["Meta", "Mistral", "OpenAI", "Alibaba", "Google"],
  meta: ["Meta", "meta"],
  mistral: ["Mistral", "mistral"],
  xai: ["SpaceXAI", "xAI", "X.AI"],
  gcli: ["SpaceXAI", "xAI", "X.AI"],
  kimi: ["Moonshot AI", "Moonshot", "kimi"],
  cf: ["Moonshot AI", "Zhipu AI", "Meta", "Mistral", "Cloudflare"],
  minimax: ["MiniMax", "minimax"],
  mm: ["MiniMax", "minimax"],
  alicode: ["Alibaba", "Qwen", "alibaba"],
  qwen: ["Alibaba", "Qwen"],
  ollama: ["Meta", "Alibaba", "DeepSeek", "Mistral", "MiniMax"],
  mimo: ["Xiaomi", "xiaomi"],
  "xiaomi-mimo": ["Xiaomi", "xiaomi"],
};

/**
 * Clean & normalize a model string for fuzzy matching
 */
export function normalizeModelName(str) {
  if (!str || typeof str !== "string") return "";
  let s = str.trim();
  // Strip bracketed tags like [1m], [beta], [dev] — they are routing hints,
  // not part of the model identity (e.g. codex's "gpt-6-astra[1m]").
  s = s.replace(/\[[^\]]*\]/g, "");
  // Strip provider prefix like 'cx/' or 'openai/'
  if (s.includes("/")) {
    s = s.split("/").slice(1).join("/");
  }
  // Strip common leading tags like @cf/
  s = s.replace(/^@[a-z0-9_-]+\//i, "");
  // Lowercase
  s = s.toLowerCase();
  // Standardize dots to dashes (e.g. 5.5 -> 5-5)
  s = s.replace(/\./g, "-");
  // Replace non-alphanumeric with hyphen
  s = s.replace(/[^a-z0-9]+/g, "-");
  return s.replace(/^-+|-+$/g, "");
}

/**
 * Remove reasoning / tier suffixes to find base model
 * e.g. 'claude-sonnet-5-5-medium' -> 'claude-sonnet-5-5'
 *      'gpt-6-sol-low' -> 'gpt-6-sol'
 */
export function baseModelSlug(slug) {
  if (!slug || typeof slug !== "string") return "";
  let s = normalizeModelName(slug);
  // Provider IDs frequently include an immutable YYYYMMDD release suffix while
  // Artificial Analysis ranks the stable family slug.
  s = s.replace(/-20\d{6,8}(?:-\d+)?$/, "");
  const suffixes = [
    "-max", "-xhigh", "-high", "-medium", "-low", "-minimal", "-none",
    "-non-reasoning", "-reasoning", "-thinking", "-latest", "-preview",
    "-exp", "-instruct", "-chat", "-default-fallback", "-fallback"
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of suffixes) {
      if (s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        changed = true;
      }
    }
  }
  return s;
}

/** Parse the embedded Next.js leaderboard array from captured page HTML. */
export function parseLeaderboardModelsFromHtml(html) {
  if (typeof html !== "string") throw new Error("Leaderboard response was not HTML");
  const idx = html.indexOf("intelligenceIndex");
  if (idx === -1) throw new Error("Could not find intelligenceIndex in Artificial Analysis HTML");

  const startIdx = html.lastIndexOf('[{\\"slug\\"', idx);
  const endIdx = html.indexOf('}],\\"messages\\"', idx);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Could not parse models array bounds from Artificial Analysis HTML");
  }

  const rawArray = html.substring(startIdx, endIdx + 2);
  const rawModels = JSON.parse(rawArray.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  return rawModels
    .filter((m) => m && Number.isFinite(m.intelligenceIndex) && !m.deprecated)
    .map((m) => ({
      slug: m.slug || "",
      name: m.name || m.slug || "",
      shortName: m.shortName || m.name || m.slug || "",
      intelligenceIndex: Math.round(m.intelligenceIndex * 100) / 100,
      modelCreatorName: m.modelCreatorName || "",
      contextWindowTokens: m.contextWindowTokens || 0,
      isReasoning: !!m.isReasoning,
      isOpenWeights: !!m.isOpenWeights,
    }))
    .sort((a, b) => b.intelligenceIndex - a.intelligenceIndex);
}

/** Read the response body with a hard size cap to bound memory use. */
async function readBodyCapped(res) {
  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
    throw new Error(`Artificial Analysis response too large (${declared} bytes)`);
  }
  if (!res.body) return res.text();
  const chunks = [];
  let bytes = 0;
  for await (const chunk of res.body) {
    const len = chunk.length ?? chunk.byteLength ?? 0;
    bytes += len;
    if (bytes > MAX_HTML_BYTES) {
      throw new Error(`Artificial Analysis response exceeded ${MAX_HTML_BYTES} bytes`);
    }
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch Artificial Analysis Leaderboard HTML and extract parsed models array
 */
export async function fetchLeaderboardModels({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (cachedLeaderboard) {
    if (!forceRefresh && now - lastFetchTime < CACHE_TTL_MS) {
      return cachedLeaderboard;
    }
    if (forceRefresh && now - lastForceFetchTime < MIN_FORCE_INTERVAL_MS) {
      console.warn("[ArtificialAnalysis] Forced refresh rate-limited; serving cached leaderboard");
      return cachedLeaderboard;
    }
  }

  const url = "https://artificialanalysis.ai/leaderboards/models";
  let html = "";
  if (forceRefresh) lastForceFetchTime = now;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    html = await readBodyCapped(res);
  } catch (err) {
    // If cached version exists, fall back to it
    if (cachedLeaderboard) {
      console.warn("[ArtificialAnalysis] Fetch failed, serving stale cache:", err.message);
      return cachedLeaderboard;
    }
    throw new Error(`Failed to fetch Artificial Analysis leaderboard: ${err.message}`);
  }

  try {
    const parsed = parseLeaderboardModelsFromHtml(html);
    if (parsed.length === 0) throw new Error("Artificial Analysis returned no active scored models");
    cachedLeaderboard = parsed;
    lastFetchTime = now;
    return parsed;
  } catch (parseErr) {
    if (cachedLeaderboard) return cachedLeaderboard;
    throw new Error(`Failed to parse Artificial Analysis models JSON: ${parseErr.message}`);
  }
}

/**
 * Token-based family matching for provider names that differ from the
 * leaderboard slug (embedded creator prefixes like "openai-gpt-6-astra",
 * region prefixes like "us.openai.gpt-6-astra", or version-less aliases
 * like "gpt-astra-latest"). Version tokens must agree when both sides
 * carry them, so "claude-sonnet-4-5" never matches "claude-sonnet-5-5".
 */
function splitVersionTokens(tokens) {
  const versions = [];
  const body = [];
  for (const t of tokens) {
    // Release dates ("20250219") are not versions — a dated route must still
    // compare equal to its stable family ("claude-3-7-sonnet").
    if (/^20\d{6,8}$/.test(t)) continue;
    // "v4" / "v2" style tokens are version markers too, so "deepseek-v4-flash"
    // never gets compared against "deepseek-v4-1-flash" as if versions matched.
    // The leading "v" is normalized away so "v4" and "4" compare as equal.
    if (/^v?\d+$/.test(t)) versions.push(t.replace(/^v/, ""));
    else body.push(t);
  }
  return { versions, body };
}

function isContiguousSubsequence(sub, sup) {
  if (sub.length === 0 || sub.length > sup.length) return false;
  outer: for (let i = 0; i + sub.length <= sup.length; i++) {
    for (let j = 0; j < sub.length; j++) {
      if (sup[i + j] !== sub[j]) continue outer;
    }
    return true;
  }
  return false;
}

function tokenFamilyMatch(aaTokens, providerTokens) {
  const aa = splitVersionTokens(aaTokens);
  const pr = splitVersionTokens(providerTokens);
  // A one-token family name is too generic to fuzzy-match on its own ("qwen3"
  // would swallow "qwen3-next") — allow it only when both names pin the exact
  // same version ("gpt-5-5" ↔ "gpt-5.5-review").
  if (aa.body.length === 0) return false;
  const samePinnedVersion =
    aa.versions.length > 0 &&
    pr.versions.length > 0 &&
    aa.versions.length === pr.versions.length &&
    aa.versions.every((v, i) => v === pr.versions[i]);
  if (aa.body.length === 1 && !samePinnedVersion) return false;
  const versionsCompatible =
    aa.versions.length === 0 ||
    pr.versions.length === 0 ||
    (aa.versions.length === pr.versions.length &&
      aa.versions.every((v, i) => v === pr.versions[i]));
  if (!versionsCompatible) return false;
  return isContiguousSubsequence(aa.body, pr.body);
}

/**
 * Match Artificial Analysis models against 9router available models
 * @param {Object} options
 * @param {Array} options.aaModels - Leaderboard models
 * @param {Array<string|Object>} options.availableModels - Models available in 9router
 * @param {number} [options.minScore] - Minimum intelligence index
 * @param {number} [options.maxScore] - Maximum intelligence index
 * @param {number} [options.limit] - Max number of models to return
 * @param {string[]} [options.creatorFilter] - Filter by model creators
 * @returns {{ models: string[], details: Array }}
 */
export function matchModelsWithLeaderboard({
  aaModels = [],
  availableModels = [],
  minScore = null,
  maxScore = null,
  limit = null,
  creatorFilter = [],
  excludeKeywords = [],
} = {}) {
  // Blank strings coerce to 0 via Number() — reject them like any other
  // non-numeric score instead of silently widening the range to 0.
  const min = minScore == null ? -Infinity : Number(String(minScore).trim() === "" ? NaN : minScore);
  const max = maxScore == null ? Infinity : Number(String(maxScore).trim() === "" ? NaN : maxScore);
  if (!Number.isFinite(min) && min !== -Infinity) throw new Error("Minimum intelligence score must be a number");
  if (!Number.isFinite(max) && max !== Infinity) throw new Error("Maximum intelligence score must be a number");
  if (min > max) throw new Error("Minimum intelligence score cannot exceed maximum score");

  // Drop provider routes whose names contain excluded keywords (e.g. "[1m]",
  // "agentic", "thinking") — case-insensitive substring match on the raw name.
  const exclusions = (Array.isArray(excludeKeywords) ? excludeKeywords : [])
    .map((k) => (typeof k === "string" ? k.trim().toLowerCase() : ""))
    .filter(Boolean);
  let usableModels = availableModels;
  if (exclusions.length > 0) {
    usableModels = availableModels.filter((item) => {
      const modelStr = typeof item === "string" ? item : (item?.value || item?.id);
      if (!modelStr) return false;
      const lowered = modelStr.toLowerCase();
      return !exclusions.some((k) => lowered.includes(k));
    });
  }

  // Filter AA models by intelligence score range. AA displays scores rounded to
  // whole numbers (44.78 renders as "45"), so a range edge typed from the
  // leaderboard must accept what the user actually sees: match if either the
  // raw index or its displayed (rounded) value falls within [min, max].
  let inRange = aaModels.filter((m) => {
    const s = m.intelligenceIndex;
    const inRawRange = s >= min && s <= max;
    const inDisplayedRange = Math.round(s) >= min && Math.round(s) <= max;
    return (inRawRange || inDisplayedRange) && !m.deprecated;
  });

  // Filter by creator if specified
  if (Array.isArray(creatorFilter) && creatorFilter.length > 0) {
    const creators = new Set(creatorFilter.map((c) => c.toLowerCase()));
    inRange = inRange.filter((m) => m.modelCreatorName && creators.has(m.modelCreatorName.toLowerCase()));
  }

  // Build lookup index for available 9router models
  // Stored as normalized slug -> Array of actual model identifiers
  const availableIndex = new Map();
  const availableBaseIndex = new Map();
  const tokenEntries = [];

  for (const item of usableModels) {
    const modelStr = typeof item === "string" ? item : (item?.value || item?.id);
    if (!modelStr) continue;

    const norm = normalizeModelName(modelStr);
    const base = baseModelSlug(norm);

    if (!availableIndex.has(norm)) availableIndex.set(norm, []);
    availableIndex.get(norm).push(modelStr);

    if (base && base !== norm) {
      if (!availableBaseIndex.has(base)) availableBaseIndex.set(base, []);
      availableBaseIndex.get(base).push(modelStr);
    }

    const tokens = norm.split("-").filter(Boolean);
    if (tokens.length > 0) tokenEntries.push({ modelStr, tokens });
  }

  const selectedModelSet = new Set();
  const matchedDetails = [];

  for (const aa of inRange) {
    const slug = aa.slug;
    const normSlug = normalizeModelName(slug);
    const baseSlug = baseModelSlug(normSlug);

    // Collect every provider route in this leaderboard family: exact/base
    // index hits first, then token-family hits for names that differ from the
    // slug (embedded creator/region prefixes, version-less aliases, etc.).
    const candidates = new Set();
    for (const key of [normSlug, baseSlug]) {
      for (const m of availableIndex.get(key) || []) candidates.add(m);
      for (const m of availableBaseIndex.get(key) || []) candidates.add(m);
    }
    const aaTokens = baseSlug.split("-").filter(Boolean);
    for (const entry of tokenEntries) {
      if (candidates.has(entry.modelStr)) continue;
      if (tokenFamilyMatch(aaTokens, entry.tokens)) candidates.add(entry.modelStr);
    }

    // Select all unselected routes in the family — a combo wants fallback
    // diversity across providers, not one representation per rank.
    for (const candidate of candidates) {
      if (selectedModelSet.has(candidate)) continue;
      selectedModelSet.add(candidate);
      matchedDetails.push({
        model: candidate,
        score: aa.intelligenceIndex,
        aaSlug: aa.slug,
        aaName: aa.name,
        creator: aa.modelCreatorName,
        isReasoning: aa.isReasoning,
        isOpenWeights: aa.isOpenWeights,
        contextWindow: aa.contextWindowTokens,
      });
      if (limit && limit > 0 && matchedDetails.length >= limit) break;
    }

    if (limit && limit > 0 && matchedDetails.length >= limit) {
      break;
    }
  }

  return {
    models: matchedDetails.map((d) => d.model),
    details: matchedDetails,
  };
}

export function selectIntelligenceModels({ aaModels = [], availableModels = [], config = {} } = {}) {
  const validated = validateIntelligenceConfig(config);
  return matchModelsWithLeaderboard({
    aaModels,
    availableModels,
    minScore: validated.minScore,
    maxScore: validated.maxScore,
    limit: validated.limit,
    excludeKeywords: validated.excludeKeywords,
  });
}

export function validateIntelligenceConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Intelligence combo configuration is required");
  if (
    config.minScore == null || config.minScore === "" ||
    config.maxScore == null || config.maxScore === ""
  ) {
    throw new Error("Intelligence scores must be numbers");
  }
  const minScore = Number(config.minScore);
  const maxScore = Number(config.maxScore);
  if (!Number.isFinite(minScore) || !Number.isFinite(maxScore)) throw new Error("Intelligence scores must be numbers");
  if (minScore > maxScore) throw new Error("Minimum intelligence score cannot exceed maximum score");
  const limit = config.limit == null || config.limit === "" ? null : Number(config.limit);
  if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
    throw new Error("Model limit must be a whole number between 1 and 50");
  }
  const refreshSchedule = config.refreshSchedule || "manual";
  if (!["manual", "hourly", "6hours", "12hours", "daily", "weekly"].includes(refreshSchedule)) {
    throw new Error("Invalid refresh schedule");
  }
  const excludeKeywords = (Array.isArray(config.excludeKeywords) ? config.excludeKeywords : [])
    .map((k) => (typeof k === "string" ? k.trim() : ""))
    .filter(Boolean)
    .slice(0, 20);
  return { type: "intelligence", minScore, maxScore, limit, refreshSchedule, excludeKeywords };
}
