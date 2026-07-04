// Context Pruning: drop old middle turns when conversation grows past threshold.
//
// Strategy (deliberately conservative — no embeddings yet):
//   - Never touches body.system / system_instruction (system prompt is sacred).
//   - Keeps the FIRST user message (often carries the initial task/context).
//   - Keeps the LAST N messages (default 8) — recent turns drive current response.
//   - Drops the middle block, replacing it with a single synthetic message:
//       { role: "user", content: "[context-pruned: N earlier turns elided to save tokens]" }
//     placed in the middle so the model knows context was removed but isn't confused
//     about turn order.
//   - Skips pruning if total estimated chars is below `minBytesToPrune` — avoids
//     unnecessary churn on short conversations.
//   - Never prunes a turn that contains a tool_use without its matching tool_result
//     (that would break Anthropic's tool_use_id pairing rule).
//
// Tunables come from settings:
//   contextPruningKeepLast    — number of trailing messages to keep (default 8)
//   contextPruningMinBytes    — only prune when total estimated bytes ≥ this (default 12000)
//
// Returns stats { prunedMessages, prunedBytes, keptMessages, totalBytesBefore } or null.

import { FORMATS } from "../translator/formats.js";
import { resolveConversationItems, isGeminiLikeFormat } from "./bodyShapes.js";

const DEFAULT_KEEP_LAST = 8;
const DEFAULT_MIN_BYTES = 12000;
const PRUNE_MARKER_PREFIX = "[context-pruned:";

export function pruneContext(body, enabled, format, opts = {}) {
  if (!enabled || !body) return null;

  const keepLast = clampInt(opts.keepLast, 4, 64, DEFAULT_KEEP_LAST);
  const minBytes = Math.max(2000, opts.minBytes ?? DEFAULT_MIN_BYTES);

  const items = resolveConversationItems(body);
  if (!items || items.length === 0) return null;

  try {
    const totalBytesBefore = estimateBytes(items);
    if (totalBytesBefore < minBytes) return null;

    // We need: first user turn index, plus the last `keepLast` items, plus a safe middle slice.
    const firstUserIdx = findFirstUserIdx(items, format);
    const keepFromIdx = Math.max(firstUserIdx + 1, items.length - keepLast);

    // Nothing to prune if everything is already kept
    if (keepFromIdx <= firstUserIdx + 1) return null;

    // Expand the prune window backward to avoid orphaning a tool_use without its tool_result.
    // For Claude/OpenAI: an assistant tool_use block is "paired" with the next message's tool_result.
    // We don't want to leave dangling pairs at either edge.
    let pruneStart = firstUserIdx + 1;
    let pruneEnd = keepFromIdx; // exclusive

    pruneStart = expandToSafeBoundary(items, pruneStart, "forward");
    pruneEnd = expandToSafeBoundary(items, pruneEnd, "backward");

    if (pruneEnd - pruneStart <= 0) return null;

    const prunedSlice = items.slice(pruneStart, pruneEnd);
    const prunedBytes = estimateBytes(prunedSlice);
    if (prunedBytes < minBytes / 4) return null; // not worth the marker overhead

    const marker = buildPruneMarker(prunedSlice.length, prunedBytes, format);
    items.splice(pruneStart, pruneEnd - pruneStart, marker);

    return {
      prunedMessages: prunedSlice.length,
      prunedBytes,
      keptMessages: items.length,
      totalBytesBefore,
    };
  } catch (e) {
    console.warn("[PRUNE] error:", e.message);
    return null;
  }
}

function clampInt(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function estimateBytes(items) {
  let total = 0;
  for (const m of items) total += sizeOfMessage(m);
  return total;
}

function sizeOfMessage(m) {
  if (!m) return 0;
  if (typeof m.content === "string") return m.content.length;
  if (Array.isArray(m.content)) {
    let s = 0;
    for (const b of m.content) {
      if (!b) continue;
      if (typeof b.text === "string") s += b.text.length;
      else if (typeof b.content === "string") s += b.content.length;
      else if (Array.isArray(b.content)) {
        for (const c of b.content) {
          if (c && typeof c.text === "string") s += c.text.length;
        }
      }
    }
    return s;
  }
  if (Array.isArray(m.parts)) {
    let s = 0;
    for (const p of m.parts) if (p && typeof p.text === "string") s += p.text.length;
    return s;
  }
  if (typeof m.output === "string") return m.output.length;
  return 0;
}

function findFirstUserIdx(items, format) {
  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    if (!m) continue;
    if (m.role === "user") return i;
  }
  return -1;
}

// Move a prune boundary outward (forward or backward) until it lands on a "safe" message
// — i.e. not splitting an assistant-tool_use ↔ user-tool_result pair.
function expandToSafeBoundary(items, idx, direction) {
  const step = direction === "forward" ? 1 : -1;
  const max = items.length;
  let i = idx;
  while (i > 0 && i < max) {
    const cur = items[i];
    const prev = items[i - 1];
    if (!hasUnpairedToolUse(prev, cur)) return i;
    i += step;
    if (i <= 0 || i >= max) return i;
  }
  return i;
}

function hasUnpairedToolUse(prev, cur) {
  if (!prev || !cur) return false;

  // Gemini / Antigravity: model turn with functionCall ↔ user turn with functionResponse
  if (Array.isArray(prev.parts)) {
    const hasFunctionCall = prev.parts.some((p) => p && p.functionCall);
    if (hasFunctionCall) {
      const hasFunctionResponse = Array.isArray(cur.parts)
        && cur.parts.some((p) => p && p.functionResponse);
      return hasFunctionResponse;
    }
  }

  // Claude / OpenAI: assistant tool_use ↔ user tool_result
  if (prev.role !== "assistant") return false;
  const blocks = Array.isArray(prev.content) ? prev.content : [];
  const hasToolUse = blocks.some((b) => b && b.type === "tool_use");
  if (!hasToolUse) return false;
  const next = cur;
  const nextBlocks = Array.isArray(next.content) ? next.content : [];
  const hasToolResult = nextBlocks.some((b) => b && b.type === "tool_result") || next.role === "tool";
  return hasToolResult; // true means they're paired — boundary would split them
}

function buildPruneMarker(prunedCount, prunedBytes, format) {
  const text = `${PRUNE_MARKER_PREFIX} ${prunedCount} earlier turn${prunedCount === 1 ? "" : "s"} elided to save ~${prunedBytes}B of context]`;

  if (format === FORMATS.CLAUDE) {
    return { role: "user", content: [{ type: "text", text }] };
  }
  if (isGeminiLikeFormat(format)) {
    return { role: "user", parts: [{ text }] };
  }
  return { role: "user", content: text };
}

export function formatPruneLog(stats) {
  if (!stats || stats.prunedMessages === 0) return null;
  return `[PRUNE] elided ${stats.prunedMessages} msgs / ${stats.prunedBytes}B (kept ${stats.keptMessages} msgs, total before=${stats.totalBytesBefore}B)`;
}
