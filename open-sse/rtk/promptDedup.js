// Prompt Deduplication: collapse duplicate large content blocks within a single request.
//
// Scope:
//   - Same-request only (no cross-request memory) — safe, deterministic, no cache invalidation.
//   - Hashes text blocks ≥ MIN_DEDUP_SIZE; the 2nd+ occurrence is replaced with a short
//     reference token "[dup-ref:<8hex> see msg #N]" so the model still knows the content
//     was present and where to find it.
//   - Targets the most common repeat-injection patterns: large user/system text blobs,
//     tool definitions echoed in subsequent turns, retrieved-doc context restated each turn.
//   - Never touches tool_result blocks (RTK owns those) and never touches blocks with
//     cache_control set (Anthropic prefix cache owns those).
//
// Shapes covered:
//   - OpenAI chat: messages[].content as string or array of {type:"text"|"input_text", text}
//   - Claude messages[].content as array of {type:"text", text} (skip tool_result)
//   - Claude body.system as array of {type:"text", text} or string
//   - OpenAI Responses input[] same shape as messages
//   - Gemini / Vertex / Antigravity: contents[].parts[].text and systemInstruction.parts

import { FORMATS } from "../translator/formats.js";
import { resolveConversationItems, isGeminiLikeFormat } from "./bodyShapes.js";

const MIN_DEDUP_SIZE = 400;       // bytes — below this, replacement token costs more than savings
const REF_PREFIX = "[dup-ref:";

// FNV-1a 32-bit — fast, no deps, good enough for collision-free dedup in a single message array.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function refToken(hex, firstMsgIdx) {
  return `${REF_PREFIX}${hex} see msg #${firstMsgIdx + 1}]`;
}

export function dedupePrompt(body, enabled, format) {
  if (!enabled || !body) return null;

  const items = resolveConversationItems(body);
  const stats = { bytesBefore: 0, bytesAfter: 0, dupBlocks: 0, hits: [] };

  try {
    const seen = new Map();

    dedupeSystemBlocks(body, format, seen, stats);

    if (!items) return stats.dupBlocks > 0 ? stats : null;

    for (let i = 0; i < items.length; i++) {
      const msg = items[i];
      if (!msg) continue;

      // OpenAI Responses top-level function_call_output — RTK's territory, skip
      if (msg.type === "function_call_output") continue;
      // OpenAI tool message — RTK's territory, skip
      if (msg.role === "tool") continue;

      // Gemini-shaped turn: parts[].text
      if (Array.isArray(msg.parts)) {
        dedupeGeminiParts(msg.parts, seen, stats, i);
        continue;
      }

      // String content
      if (typeof msg.content === "string") {
        msg.content = replaceStringIfDup(msg.content, seen, stats, i);
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      for (let j = 0; j < msg.content.length; j++) {
        const blk = msg.content[j];
        if (!blk) continue;
        // tool_result owned by RTK; tool_use carries call args, leave alone
        if (blk.type === "tool_result" || blk.type === "tool_use") continue;
        // Skip cache_control-marked blocks (Anthropic prefix cache)
        if (blk.cache_control) continue;
        if (!isPlainTextBlock(blk)) continue;
        const textField = blk.type === "input_text" || blk.type === "text" ? "text" : null;
        if (!textField) continue;
        replaceIfDup(blk, textField, seen, stats, i);
      }
    }
  } catch (e) {
    console.warn("[DEDUP] error:", e.message);
    return null;
  }

  return stats.dupBlocks > 0 ? stats : null;
}

function dedupeSystemBlocks(body, format, seen, stats) {
  // Claude body.system (array or string)
  if (format === FORMATS.CLAUDE) {
    if (Array.isArray(body.system)) {
      for (let i = 0; i < body.system.length; i++) {
        const blk = body.system[i];
        if (!isPlainTextBlock(blk)) continue;
        if (blk.cache_control) continue;
        replaceIfDup(blk, "text", seen, stats, -1 - i);
      }
    } else if (typeof body.system === "string") {
      body.system = replaceStringIfDup(body.system, seen, stats, -1);
    }
    return;
  }

  // Gemini systemInstruction.parts
  if (isGeminiLikeFormat(format) && body.systemInstruction?.parts) {
    dedupeGeminiParts(body.systemInstruction.parts, seen, stats, -1);
    return;
  }

  // Antigravity nests system under request
  if (format === FORMATS.ANTIGRAVITY && body.request?.systemInstruction?.parts) {
    dedupeGeminiParts(body.request.systemInstruction.parts, seen, stats, -1);
  }
}

function dedupeGeminiParts(parts, seen, stats, msgIdx) {
  for (let j = 0; j < parts.length; j++) {
    const part = parts[j];
    if (!part || part.thought || part.functionCall || part.functionResponse) continue;
    if (typeof part.text !== "string") continue;
    replaceIfDup(part, "text", seen, stats, msgIdx);
  }
}

function isPlainTextBlock(blk) {
  if (!blk || typeof blk !== "object") return false;
  if (blk.type === "text" || blk.type === "input_text") {
    return typeof blk.text === "string";
  }
  return false;
}

function replaceIfDup(blk, field, seen, stats, msgIdx) {
  const text = blk[field];
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;
  if (bytesIn < MIN_DEDUP_SIZE) { stats.bytesAfter += bytesIn; return; }

  const h = hash(text);
  if (!seen.has(h)) {
    seen.set(h, msgIdx);
    stats.bytesAfter += bytesIn;
    return;
  }

  const firstMsgIdx = seen.get(h);
  const replacement = refToken(h, Math.max(firstMsgIdx, 0));
  blk[field] = replacement;
  stats.bytesAfter += replacement.length;
  stats.dupBlocks += 1;
  stats.hits.push({ hash: h, savedBytes: bytesIn - replacement.length, firstMsgIdx });
}

function replaceStringIfDup(text, seen, stats, msgIdx) {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;
  if (bytesIn < MIN_DEDUP_SIZE) { stats.bytesAfter += bytesIn; return text; }

  const h = hash(text);
  if (!seen.has(h)) {
    seen.set(h, msgIdx);
    stats.bytesAfter += bytesIn;
    return text;
  }

  const firstMsgIdx = seen.get(h);
  const replacement = refToken(h, Math.max(firstMsgIdx, 0));
  stats.bytesAfter += replacement.length;
  stats.dupBlocks += 1;
  stats.hits.push({ hash: h, savedBytes: bytesIn - replacement.length, firstMsgIdx });
  return replacement;
}

export function formatDedupLog(stats) {
  if (!stats || stats.dupBlocks === 0) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
  return `[DEDUP] collapsed ${stats.dupBlocks} block${stats.dupBlocks === 1 ? "" : "s"} | saved ${saved}B (${pct}%)`;
}
