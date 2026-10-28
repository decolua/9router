/**
 * Tool normalization before dispatch:
 * - MCP-equivalent built-in tool dedup (Claude clients only, reduces token bloat).
 * - Exact same-name tool dedup for DeepSeek models — the DeepSeek upstream rejects
 *   duplicate tool names with 400 "Tool names must be unique" on every endpoint
 *   (verified live 2026-08-15 against api.deepseek.com, opencode.go and a LiteLLM
 *   gateway; GLM/MiniMax/Kimi upstreams accept duplicates). First definition wins,
 *   tool_choice and message-history references are by name/id so nothing breaks.
 */
import { isDeepSeekModel } from "../providers/models/helpers.js";

const DEDUP_RULES = [
  {
    // Exa MCP present → drop built-in web tools (Exa is preferred).
    triggers: ["mcp__exa__web_search_exa", "mcp__exa__web_fetch_exa"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Tavily MCP present → drop built-in web tools.
    triggers: ["mcp__tavily__tavily_search", "mcp__tavily__tavily_extract"],
    strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"],
  },
  {
    // Browser MCP present → drop Cowork's duplicate Claude_in_Chrome connector.
    triggers: [/^mcp__browsermcp__/],
    strip: [/^mcp__Claude_in_Chrome__/],
  },
];

// ponytail: RANK_* thresholds are fixed at module scope; promote to settingsRepo only if measurement shows they are wrong for real traffic.
const RANK_MIN_TOOLS  = 16;
const RANK_KEEP_RATIO = 0.5;
const RANK_DROP_CAP   = 0.4;
const RANK_QUERY_MSGS = 3;
const RANK_QUERY_MAX  = 8000;

const RANK_STOPWORDS = new Set(
  "the,a,an,and,or,of,to,in,is,it,for,on,with,this,that,you,your,be,are,as,at,by,from,if,not".split(",")
);

function getToolName(t) {
  return t?.name || t?.function?.name || "";
}

function matches(name, pattern) {
  if (typeof pattern === "string") return name === pattern;
  return pattern instanceof RegExp ? pattern.test(name) : false;
}

/**
 * @param {Array} tools - translated tools array
 * @param {Object} [opts]
 * @param {string|null} [opts.clientTool] - detected client ("claude" | "codex" | ...)
 * @param {string|null} [opts.model] - model id, may carry a (level) thinking suffix
 * @returns {{ tools: Array, stripped: Array<string> }}
 */
function dedupeTools(tools, opts = {}) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stripped: [] };
  const names = tools.map(getToolName);
  const toStrip = new Set();
  const toDrop = new Set(); // indices of duplicate same-name tools

  // MCP-based built-in dedup: Claude clients only (existing behavior).
  if (opts.clientTool === "claude") {
    for (const rule of DEDUP_RULES) {
      const hasTrigger = names.some((n) => rule.triggers.some((p) => matches(n, p)));
      if (!hasTrigger) continue;
      for (const n of names) {
        if (rule.strip.some((p) => matches(n, p))) toStrip.add(n);
      }
    }
  }

  // Exact-name dedup: DeepSeek upstream rejects duplicate tool names. Applies to
  // every client × provider that serves a deepseek-* model (official API, Console Go,
  // LiteLLM gateways); non-DeepSeek models are untouched.
  if (isDeepSeekModel(opts.model)) {
    const seen = new Set();
    for (let i = 0; i < tools.length; i++) {
      const n = getToolName(tools[i]);
      if (!n) continue;
      if (seen.has(n)) toDrop.add(i);
      else seen.add(n);
    }
  }

  if (toStrip.size === 0 && toDrop.size === 0) return { tools, stripped: [] };
  const out = tools.filter((t, i) => !toDrop.has(i) && !toStrip.has(getToolName(t)));
  const stripped = Array.from(toDrop).map((i) => getToolName(tools[i])).concat(Array.from(toStrip));
  return { tools: out, stripped };
}

function rankTokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 2 && !RANK_STOPWORDS.has(tok));
}

function rankQueryText(messages, maxMsgs, maxChars) {
  if (!Array.isArray(messages)) return "";
  const parts = [];
  for (const m of messages.slice(-maxMsgs)) {
    const content = m?.content;
    if (typeof content === "string") parts.push(content);
    else if (Array.isArray(content)) {
      for (const p of content) if (p && p.type === "text" && typeof p.text === "string") parts.push(p.text);
    }
  }
  return parts.join(" ").toLowerCase().slice(0, maxChars);
}

/**
 * Lexical relevance ranking: drop tool definitions that share zero words with
 * the recent messages. Fail-open: never throws, returns the input untouched on
 * any error, on a small tool set, or on an empty query.
 * @param {Array} tools - translated tools array
 * @param {Object} [opts]
 * @param {Array} [opts.messages] - recent request messages (last 3 used)
 * @returns {{ tools: Array, stripped: Array<string> }}
 */
function rankTools(tools, opts = {}) {
  try {
    if (!Array.isArray(tools) || tools.length < RANK_MIN_TOOLS) return { tools, stripped: [] };

    const queryText = rankQueryText(opts.messages, RANK_QUERY_MSGS, RANK_QUERY_MAX);
    if (!queryText) return { tools, stripped: [] };
    const queryTokens = new Set(rankTokenize(queryText));

    const scored = tools.map((t, i) => {
      const name = getToolName(t);
      const desc = t?.description || t?.function?.description || "";
      const tokens = rankTokenize(`${name} ${desc}`);
      let score = 0;
      for (const tok of tokens) if (queryTokens.has(tok)) score++;
      const forceKeep = !!name && queryText.includes(name.toLowerCase());
      return { i, name, score, forceKeep };
    });

    const keepFloor = Math.ceil(tools.length * RANK_KEEP_RATIO);
    const maxDrop = Math.floor(tools.length * RANK_DROP_CAP);
    const allowable = Math.min(maxDrop, tools.length - keepFloor);

    const candidates = scored
      .filter((s) => s.score === 0 && !s.forceKeep)
      .map((s) => ({ ...s, size: JSON.stringify(tools[s.i]).length }))
      .sort((a, b) => b.size - a.size)
      .slice(0, Math.max(0, allowable));

    if (candidates.length === 0) return { tools, stripped: [] };

    const dropIdx = new Set(candidates.map((c) => c.i));
    const kept = tools.filter((_, i) => !dropIdx.has(i));
    return { tools: kept, stripped: candidates.map((c) => c.name) };
  } catch {
    return { tools, stripped: [] };
  }
}

export { dedupeTools, rankTools };
