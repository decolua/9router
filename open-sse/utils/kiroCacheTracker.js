/**
 * Kiro prompt-cache accounting (local heuristic).
 *
 * Amazon Q / CodeWhisperer (the Kiro upstream) does NOT emit cache_creation /
 * cache_read token fields, so we can't read cache usage from the response. This
 * module reconstructs a plausible cache breakdown locally, modeled after the
 * Kiro-Go reference (proxy/cache_tracker.go):
 *
 *   - Only applies to Kiro provider + Claude-source requests (cache_control is a
 *     Claude concept).
 *   - Honors explicit `cache_control: { type: "ephemeral" }` breakpoints. Once an
 *     explicit breakpoint is seen, later message-end boundaries become implicit
 *     breakpoints so multi-turn conversations can hit earlier stored prefixes.
 *   - Enforces Anthropic's minimum cacheable prefix (1024 tokens default, 4096
 *     for Opus) so short requests don't report unrealistic 100% cache hits.
 *   - Tracks stored prefixes per connectionId with 5m (default) or 1h TTL.
 *   - Uses a deterministic canonical JSON fingerprint that ignores volatile
 *     `x-anthropic-billing-header:` blocks and cache_control metadata.
 *
 * First matching request reports cache_creation_input_tokens; a repeated request
 * hitting a live stored prefix reports cache_read_input_tokens. The resulting
 * usage is shaped so the existing canonicalizeUsage() fold path re-includes cache
 * into an inclusive prompt total.
 */
import { createHash } from "node:crypto";
import { FORMATS } from "../translator/formats.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
export const DEFAULT_PROMPT_CACHE_TTL_MS = 5 * MINUTE_MS;

// Anthropic requires a cached prefix to reach a minimum token count before
// caching takes effect. Prefixes below this are excluded from matching/storage.
const DEFAULT_MIN_CACHEABLE_TOKENS = 1024;
const OPUS_MIN_CACHEABLE_TOKENS = 4096;

// The newest content in a request is never fully served from cache on the
// current turn — cap cacheable tokens at 85% of the total input.
const MAX_CACHEABLE_FRACTION = 0.85;

const CACHE_POSITION_KEYS = new Set(["tool_index", "system_index", "message_index", "block_index"]);

function minCacheableTokensForModel(model) {
  return String(model || "").toLowerCase().includes("opus")
    ? OPUS_MIN_CACHEABLE_TOKENS
    : DEFAULT_MIN_CACHEABLE_TOKENS;
}

/**
 * Approximate token count for a string, ported from Kiro-Go token_estimator.go.
 * Weights ASCII letters, digits, symbols and non-ASCII runes differently to
 * roughly track real tokenizer behavior. Deterministic.
 */
export function estimateApproxTokens(text) {
  if (!text || typeof text !== "string") return 0;
  const runes = Array.from(text);
  const length = runes.length;
  if (length === 0) return 0;
  if (length < 5) return Math.max(1, Math.ceil(length / 3.0));

  let regularAscii = 0, digits = 0, symbols = 0, nonASCII = 0;
  for (const ch of runes) {
    const r = ch.codePointAt(0);
    if (r >= 0x80) nonASCII++;
    else if (r >= 0x30 && r <= 0x39) digits++;
    else if ((r >= 0x21 && r <= 0x2f) || (r >= 0x3a && r <= 0x40) || (r >= 0x5b && r <= 0x60) || (r >= 0x7b && r <= 0x7e)) symbols++;
    else regularAscii++;
  }

  const estimated = Math.ceil(
    regularAscii / 4.5 + digits / 2.0 + symbols / 1.5 + nonASCII / 1.5
  );
  return estimated < 1 ? 1 : estimated;
}

/**
 * Deterministic canonical JSON: object keys sorted, cache_control dropped, arrays
 * order-preserving. Used for stable prefix fingerprints across otherwise-identical
 * requests whose key ordering or cache_control markers may drift.
 */
export function canonicalizeCacheValue(value) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalizeCacheValue).join(",") + "]";
  }
  if (t === "object") {
    const keys = Object.keys(value).filter((k) => k !== "cache_control").sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalizeCacheValue(value[k])).join(",") + "}";
  }
  return JSON.stringify(value ?? null);
}

// Length-prefixed framing so distinct chunk boundaries can't collide.
function writeHashChunk(hasher, chunk) {
  hasher.update(String(Buffer.byteLength(chunk, "utf8")));
  hasher.update(NUL);
  hasher.update(chunk, "utf8");
  hasher.update(NUL);
}
const NUL = Buffer.from([0]);

function stripCachePositionKeys(wrapper) {
  const cloned = {};
  for (const key of Object.keys(wrapper)) {
    if (CACHE_POSITION_KEYS.has(key)) continue;
    cloned[key] = wrapper[key];
  }
  return cloned;
}

// x-anthropic-billing-header text blocks are volatile metadata (they drift or
// appear/disappear across otherwise-identical requests) and must be excluded
// from the cache fingerprint.
function isAnthropicBillingHeaderBlock(block) {
  if (!block || typeof block !== "object") return false;
  const type = typeof block.type === "string" ? block.type : "";
  if (type && type !== "text") return false;
  if (typeof block.text !== "string") return false;
  return block.text.replace(/^[\s]+/, "").toLowerCase().startsWith("x-anthropic-billing-header:");
}

function extractPromptCacheTTLMs(value) {
  const block = value && typeof value === "object" ? value : null;
  const cacheControl = block?.cache_control;
  if (!cacheControl || typeof cacheControl !== "object") return 0;
  if (String(cacheControl.type || "").toLowerCase() !== "ephemeral") return 0;

  const ttl = parsePromptCacheTTLValue(cacheControl.ttl);
  return ttl > 0 ? ttl : DEFAULT_PROMPT_CACHE_TTL_MS;
}

function parsePromptCacheTTLValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value * 1000; // seconds → ms
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return 0;
    const m = trimmed.match(/^(\d+)\s*(ms|s|m|h)?$/);
    if (m) {
      const n = Number(m[1]);
      switch (m[2]) {
        case "ms": return n;
        case "h": return n * HOUR_MS;
        case "m": return n * MINUTE_MS;
        case "s":
        default: return n * 1000;
      }
    }
  }
  return 0;
}

// 5m/default and 1h are the only supported windows: anything above 5m → 1h.
function normalizePromptCacheTTLMs(ttl) {
  if (ttl <= 0) return 0;
  if (ttl > DEFAULT_PROMPT_CACHE_TTL_MS) return HOUR_MS;
  return DEFAULT_PROMPT_CACHE_TTL_MS;
}

function appendPromptBlock(blocks, wrapper, isMessageEnd) {
  const blockValue = wrapper.block;
  if (isAnthropicBillingHeaderBlock(blockValue)) return;
  const ttl = normalizePromptCacheTTLMs(extractPromptCacheTTLMs(blockValue));
  const fingerprintValue = stripCachePositionKeys(wrapper);
  const canonical = canonicalizeCacheValue(fingerprintValue);
  blocks.push({ value: fingerprintValue, tokens: estimateApproxTokens(canonical), ttl, isMessageEnd });
}

function appendSystemCacheBlocks(blocks, system) {
  if (typeof system === "string") {
    appendPromptBlock(blocks, { kind: "system", system_index: 0, block: { type: "text", text: system } }, false);
    return;
  }
  if (Array.isArray(system)) {
    system.forEach((block, i) => {
      const wrapped = typeof block === "string" ? { type: "text", text: block } : block;
      appendPromptBlock(blocks, { kind: "system", system_index: i, block: wrapped }, false);
    });
  }
}

function appendMessageCacheBlocks(blocks, messageIndex, msg) {
  const role = msg?.role;
  const content = msg?.content;
  if (typeof content === "string") {
    appendPromptBlock(blocks, { kind: "message", message_index: messageIndex, role, block_index: 0, block: { type: "text", text: content } }, true);
    return;
  }
  if (Array.isArray(content)) {
    const lastIdx = content.length - 1;
    content.forEach((block, blockIndex) => {
      appendPromptBlock(blocks, { kind: "message", message_index: messageIndex, role, block_index: blockIndex, block }, blockIndex === lastIdx);
    });
    return;
  }
  if (content != null) {
    appendPromptBlock(blocks, { kind: "message", message_index: messageIndex, role, block_index: 0, block: content }, true);
  }
}

function flattenClaudeCacheBlocks(req) {
  const blocks = [];

  // Request prelude (model + tool_choice): never a breakpoint itself.
  const prelude = { kind: "request_prelude", model: req.model, tool_choice: req.tool_choice ?? null };
  blocks.push({ value: prelude, tokens: estimateApproxTokens(canonicalizeCacheValue(prelude)), ttl: 0, isMessageEnd: false });

  for (const [toolIndex, tool] of (req.tools || []).entries()) {
    const toolValue = {
      kind: "tool",
      tool_index: toolIndex,
      name: tool?.name,
      description: tool?.description,
      input_schema: tool?.input_schema,
    };
    const fingerprintValue = stripCachePositionKeys(toolValue);
    blocks.push({
      value: fingerprintValue,
      tokens: estimateApproxTokens(canonicalizeCacheValue(fingerprintValue)),
      ttl: normalizePromptCacheTTLMs(extractPromptCacheTTLMs(tool)),
      isMessageEnd: false,
    });
  }

  appendSystemCacheBlocks(blocks, req.system);
  (req.messages || []).forEach((msg, i) => appendMessageCacheBlocks(blocks, i, msg));

  return blocks;
}

/**
 * Build a prompt-cache profile from a Claude request. Returns null when there
 * are no cache_control breakpoints (nothing to account for).
 *
 * @param {object} req - Claude-format request body
 * @param {number} totalInputTokens - reported input tokens for the request
 * @returns {{breakpoints: Array<{fingerprint:string, cumulativeTokens:number, ttl:number}>, totalInputTokens:number, model:string}|null}
 */
export function buildClaudeCacheProfile(req, totalInputTokens) {
  if (!req || typeof req !== "object") return null;
  const blocks = flattenClaudeCacheBlocks(req);
  if (blocks.length === 0) return null;

  const hasher = createHash("sha256");
  const breakpoints = [];
  let cumulativeTokens = 0;
  let activeTTL = 0;

  for (const block of blocks) {
    writeHashChunk(hasher, canonicalizeCacheValue(block.value));
    cumulativeTokens += block.tokens;

    let breakpointTTL = 0;
    if (block.ttl > 0) {
      breakpointTTL = block.ttl;
      activeTTL = block.ttl;
    } else if (block.isMessageEnd && activeTTL > 0) {
      breakpointTTL = activeTTL;
    }
    if (breakpointTTL <= 0) continue;

    const fingerprint = hasher.copy().digest("hex");
    breakpoints.push({ fingerprint, cumulativeTokens, ttl: breakpointTTL });
  }

  if (breakpoints.length === 0) return null;

  let total = Number(totalInputTokens) || 0;
  if (total < cumulativeTokens) total = cumulativeTokens;

  return { breakpoints, totalInputTokens: total, model: req.model };
}

function emptyCacheUsage() {
  return { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0 };
}

function computeTTLBreakdown(profile, matchedTokens) {
  let cache5m = 0, cache1h = 0;
  let previous = matchedTokens;
  for (const bp of profile.breakpoints) {
    const current = Math.min(bp.cumulativeTokens, profile.totalInputTokens);
    if (current <= previous) continue;
    const delta = current - previous;
    if (bp.ttl >= HOUR_MS) cache1h += delta;
    else cache5m += delta;
    previous = current;
  }
  return { cache5m, cache1h };
}

/**
 * Per-connection prompt cache tracker. State is a Map<connectionId, Map<fingerprint,{expiresAt,ttl}>>.
 */
export class KiroCacheTracker {
  constructor() {
    this.entriesByConnection = new Map();
  }

  pruneExpired(now) {
    for (const [connId, entries] of this.entriesByConnection) {
      for (const [fp, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(fp);
      }
      if (entries.size === 0) this.entriesByConnection.delete(connId);
    }
  }

  /**
   * Compute the cache breakdown for a request WITHOUT mutating stored state
   * (aside from refreshing the TTL of a matched live entry, mirroring the Go
   * reference). Call update() afterwards to store the request's breakpoints.
   */
  compute(connectionId, profile, now = Date.now()) {
    if (!profile || !profile.breakpoints?.length || !connectionId) return emptyCacheUsage();

    const minTokens = minCacheableTokensForModel(profile.model);
    const last = profile.breakpoints[profile.breakpoints.length - 1];
    let lastTokens = Math.min(last.cumulativeTokens, profile.totalInputTokens);

    this.pruneExpired(now);
    const entries = this.entriesByConnection.get(connectionId);

    if (!entries || entries.size === 0) {
      // First request for this connection: report creation only if above threshold.
      const effectiveCreation = lastTokens < minTokens ? 0 : lastTokens;
      const { cache5m, cache1h } = computeTTLBreakdown(profile, 0);
      return {
        cacheCreationInputTokens: effectiveCreation,
        cacheReadInputTokens: 0,
        cacheCreation5mInputTokens: cache5m,
        cacheCreation1hInputTokens: cache1h,
      };
    }

    const maxCacheable = Math.floor(profile.totalInputTokens * MAX_CACHEABLE_FRACTION);
    if (lastTokens > maxCacheable) lastTokens = maxCacheable;

    let matchedTokens = 0;
    for (let i = profile.breakpoints.length - 1; i >= 0; i--) {
      const bp = profile.breakpoints[i];
      if (bp.cumulativeTokens < minTokens) continue;
      const entry = entries.get(bp.fingerprint);
      if (!entry || entry.expiresAt < now) continue;
      // Sliding refresh on hit; replace the entry rather than mutating it.
      entries.set(bp.fingerprint, { ...entry, expiresAt: now + entry.ttl });
      matchedTokens = Math.min(bp.cumulativeTokens, profile.totalInputTokens);
      if (matchedTokens > lastTokens) matchedTokens = lastTokens;
      break;
    }

    const creation = Math.max(lastTokens - matchedTokens, 0);
    const { cache5m, cache1h } = computeTTLBreakdown(profile, matchedTokens);
    return {
      cacheCreationInputTokens: creation,
      cacheReadInputTokens: matchedTokens,
      cacheCreation5mInputTokens: cache5m,
      cacheCreation1hInputTokens: cache1h,
    };
  }

  /** Store the request's breakpoints (above the minimum threshold) for future hits. */
  update(connectionId, profile, now = Date.now()) {
    if (!profile || !profile.breakpoints?.length || !connectionId) return;
    const minTokens = minCacheableTokensForModel(profile.model);
    this.pruneExpired(now);

    let entries = this.entriesByConnection.get(connectionId);
    if (!entries) {
      entries = new Map();
      this.entriesByConnection.set(connectionId, entries);
    }
    for (const bp of profile.breakpoints) {
      if (bp.cumulativeTokens < minTokens) continue;
      entries.set(bp.fingerprint, { expiresAt: now + bp.ttl, ttl: bp.ttl });
    }
  }
}

// Process-wide singleton so cache state persists across requests.
export const defaultKiroCacheTracker = new KiroCacheTracker();

/**
 * Merge locally-computed Kiro cache accounting into a usage object.
 *
 * No-op unless provider is "kiro" AND the client request was Claude-source. On a
 * cache hit/creation it reduces prompt_tokens to the cache-EXCLUSIVE (billed)
 * portion and adds cache_creation_input_tokens / cache_read_input_tokens so the
 * existing canonicalizeUsage() Claude fold path re-includes cache into an
 * inclusive prompt total. Returns the input usage unchanged when not applicable.
 *
 * @returns {object|null} a (possibly new) usage object, or the original reference
 */
export function applyKiroCacheAccounting({ provider, sourceFormat, body, model, connectionId, usage, tracker = defaultKiroCacheTracker, now = Date.now() }) {
  if (!usage || typeof usage !== "object") return usage;
  if (provider !== "kiro") return usage;
  if (sourceFormat !== FORMATS.CLAUDE) return usage;
  if (!connectionId) return usage;

  // Respect real upstream cache data if it ever appears — never override it with
  // the local heuristic. (Amazon Q emits none today, but stay forward-safe.)
  if (usage.cache_read_input_tokens !== undefined ||
      usage.cache_creation_input_tokens !== undefined ||
      usage.cached_tokens !== undefined) {
    return usage;
  }

  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens);
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return usage;

  const profile = buildClaudeCacheProfile(body, inputTokens);
  if (!profile) return usage;

  const cache = tracker.compute(connectionId, profile, now);
  tracker.update(connectionId, profile, now);

  const creation = cache.cacheCreationInputTokens;
  const read = cache.cacheReadInputTokens;
  if (creation <= 0 && read <= 0) return usage;

  const billed = Math.max(inputTokens - creation - read, 0);
  const result = { ...usage };
  result.prompt_tokens = billed;
  if (result.input_tokens !== undefined) result.input_tokens = billed;
  // Emit Claude-style cache fields (no cached_tokens) so canonicalizeUsage folds.
  if (creation > 0) result.cache_creation_input_tokens = creation;
  if (read > 0) result.cache_read_input_tokens = read;
  // total_tokens is recomputed downstream from the inclusive prompt; drop stale.
  delete result.total_tokens;
  return result;
}
