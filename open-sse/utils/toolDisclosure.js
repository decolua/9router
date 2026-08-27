/**
 * Progressive tool disclosure: BM25-based per-turn tool selection.
 *
 * Maintains a session-level index (keyed by connectionId) so schemas are
 * parsed and tokenized once per session, not once per turn. The index is
 * rebuilt only when the tool name set changes.
 *
 * Config shape:
 *   maxTools   number  – top-K tools to keep after scoring (default 20)
 *   minScore   number  – BM25 score floor; 0.0 keeps any matching token (default)
 *   alwaysInclude string[] – tool names never filtered (merged with pinned set)
 */

// BM25 tuning constants (Okapi BM25 standard defaults)
const K1 = 1.5;
const B = 0.75;

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "it", "in", "on", "at", "to", "for", "of", "and",
  "or", "but", "with", "from", "by", "as", "this", "that", "can", "will",
  "be", "are", "was", "were", "has", "have", "had", "do", "does", "did",
  "not", "no", "if", "its", "your", "my", "get", "set", "use", "via",
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function getToolName(t) {
  return t?.name || t?.function?.name || "";
}

function getDocText(tool) {
  const name = getToolName(tool);
  const desc = tool?.description || tool?.function?.description || "";
  const schema = tool?.input_schema || tool?.function?.parameters || {};
  const paramNames = Object.keys(schema?.properties || {});

  // Split mcp__server__tool_name into component words; repeat name tokens for weight.
  const nameParts = name.replace(/^mcp__[^_]+__/, "").split(/_+/).filter(Boolean);
  const serverParts = name.match(/^mcp__([^_]+)__/)?.[1]?.split(/_+/) || [];

  return [
    ...nameParts, ...nameParts, ...nameParts,
    ...serverParts,
    desc,
    ...paramNames,
  ].join(" ");
}

function buildIndex(tools) {
  const docs = tools.map((tool, i) => {
    const tokens = tokenize(getDocText(tool));
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    return { i, tf, dl: tokens.length };
  });

  const df = {};
  for (const doc of docs) {
    for (const term of Object.keys(doc.tf)) df[term] = (df[term] || 0) + 1;
  }

  const N = docs.length;
  const avgdl = N ? docs.reduce((s, d) => s + d.dl, 0) / N : 1;

  return { docs, df, N, avgdl };
}

function bm25Scores(index, queryTokens) {
  const { docs, df, N, avgdl } = index;
  const scores = new Array(N).fill(0);

  for (const term of queryTokens) {
    const docFreq = df[term] || 0;
    if (docFreq === 0) continue;
    const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);

    for (const doc of docs) {
      const tf = doc.tf[term] || 0;
      if (tf === 0) continue;
      scores[doc.i] += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.dl / avgdl));
    }
  }

  return scores;
}

function getToolSetId(tools) {
  return tools.map(getToolName).sort().join("|");
}

function extractLastUserMessage(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((b) => b?.type === "text" || typeof b?.text === "string")
        .map((b) => b.text || "")
        .join(" ");
    }
  }
  return "";
}

function extractPinnedNames(body, alwaysInclude = []) {
  const pinned = new Set(alwaysInclude);
  pinned.add("ToolSearch"); // Claude Code harness deferred-schema mechanism

  for (const msg of body?.messages || []) {
    // OpenAI format
    for (const tc of msg?.tool_calls || []) {
      const n = tc?.function?.name || tc?.name;
      if (n) pinned.add(n);
    }
    // Claude format
    for (const block of Array.isArray(msg?.content) ? msg.content : []) {
      if (block?.type === "tool_use" && block.name) pinned.add(block.name);
    }
  }

  // Forced tool_choice
  const forced = body?.tool_choice?.name || body?.tool_choice?.function?.name;
  if (forced) pinned.add(forced);

  return pinned;
}

// Session cache: connectionId → { toolSetId, index, tools, lastSeen }
const _cache = new Map();
const MAX_CACHE_SIZE = 500;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function pruneCache() {
  if (_cache.size < MAX_CACHE_SIZE) return;
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, v] of _cache) {
    if (v.lastSeen < cutoff) _cache.delete(k);
  }
  // If still too large, evict oldest half
  if (_cache.size >= MAX_CACHE_SIZE) {
    const sorted = [..._cache.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    for (let i = 0; i < sorted.length / 2; i++) _cache.delete(sorted[i][0]);
  }
}

function getOrBuildEntry(connectionId, tools) {
  const toolSetId = getToolSetId(tools);
  const cached = _cache.get(connectionId);
  if (cached && cached.toolSetId === toolSetId) {
    cached.lastSeen = Date.now();
    return cached;
  }
  pruneCache();
  const entry = { toolSetId, index: buildIndex(tools), tools, lastSeen: Date.now() };
  _cache.set(connectionId, entry);
  return entry;
}

/**
 * Select the most relevant tools for the current turn via BM25.
 *
 * Returns { tools: Tool[], stats: { before, after, stripped } | null }
 * Returns stats=null when no filtering occurred (pass-through).
 */
export function disclosureTools(tools, body, connectionId, config = {}) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stats: null };

  const maxTools = config.maxTools ?? 20;
  const minScore = config.minScore ?? 0.0;
  const alwaysInclude = config.alwaysInclude || [];

  if (tools.length <= maxTools) return { tools, stats: null };

  if (!connectionId) {
    // No session anchor — return first maxTools, respecting pinned
    const pinned = extractPinnedNames(body, alwaysInclude);
    const pinnedTools = tools.filter((t) => pinned.has(getToolName(t)));
    const rest = tools.filter((t) => !pinned.has(getToolName(t)));
    const selected = [...pinnedTools, ...rest].slice(0, maxTools);
    return { tools: selected, stats: { before: tools.length, after: selected.length, stripped: tools.length - selected.length } };
  }

  const { index } = getOrBuildEntry(connectionId, tools);
  const pinned = extractPinnedNames(body, alwaysInclude);
  const query = extractLastUserMessage(body);
  const queryTokens = tokenize(query);

  const pinnedTools = [];
  const candidates = [];
  for (let i = 0; i < tools.length; i++) {
    if (pinned.has(getToolName(tools[i]))) {
      pinnedTools.push({ tool: tools[i], score: Infinity });
    } else {
      candidates.push({ tool: tools[i], i });
    }
  }

  const budget = Math.max(0, maxTools - pinnedTools.length);

  let topK;
  if (queryTokens.length === 0) {
    topK = candidates.slice(0, budget).map((c) => c.tool);
  } else {
    const scores = bm25Scores(index, queryTokens);
    candidates.sort((a, b) => (scores[b.i] || 0) - (scores[a.i] || 0));
    topK = candidates
      .filter((c) => (scores[c.i] || 0) >= minScore)
      .slice(0, budget)
      .map((c) => c.tool);
  }

  const selected = [...pinnedTools.map((x) => x.tool), ...topK];
  const strippedSet = new Set(selected.map(getToolName));
  const stats = {
    before: tools.length,
    after: selected.length,
    stripped: tools.length - selected.length,
    keptNames: selected.map(getToolName),
    strippedNames: tools.filter((t) => !strippedSet.has(getToolName(t))).map(getToolName),
  };
  _recordStats({ connectionId, ...stats });
  return { tools: selected, stats };
}

// --- Recent stats ring buffer (last 50 turns) ---
const _recentStats = [];
const STATS_MAX = 50;

function _recordStats(entry) {
  _recentStats.unshift({ ts: Date.now(), ...entry });
  if (_recentStats.length > STATS_MAX) _recentStats.length = STATS_MAX;
}

export function getRecentStats() {
  return _recentStats.slice();
}

// Exported for tests only
export { buildIndex, bm25Scores, tokenize, extractPinnedNames, extractLastUserMessage, _cache, _recentStats };
