import {
  KIRO_IMAGE_DROP_NOTICE,
  KIRO_MAX_PAYLOAD_BYTES,
  KIRO_TRUNCATION_NOTICE,
} from "../config/kiroConstants.js";
import { shrinkKiroImage } from "./kiroImage.js";

const encoder = new TextEncoder();

function payloadBytes(payload) {
  return encoder.encode(JSON.stringify(payload)).byteLength;
}

function textBytes(value) {
  return encoder.encode(String(value || "")).byteLength;
}

// Byte-safe cut that never splits a UTF-8 sequence (Go's content[:n] could).
function cutBytes(value, keepBytes) {
  const raw = String(value || "");
  const buffer = Buffer.from(raw, "utf8");
  if (keepBytes >= buffer.byteLength) return raw;
  let cut = buffer.subarray(0, Math.max(0, keepBytes)).toString("utf8");
  if (cut.endsWith("\uFFFD")) cut = cut.slice(0, -1);
  return cut;
}

function imagesOf(entry) {
  return entry?.userInputMessage?.images;
}

function resizeImages(payload) {
  const targets = [];
  const state = payload?.conversationState;
  if (Array.isArray(state?.currentMessage?.userInputMessage?.images)) {
    targets.push(state.currentMessage.userInputMessage);
  }
  for (const entry of state?.history || []) {
    if (Array.isArray(entry?.userInputMessage?.images)) targets.push(entry.userInputMessage);
  }
  for (const holder of targets) {
    let changed = false;
    const shrunk = holder.images.map((image) => {
      const out = shrinkKiroImage(image);
      if (out !== image) changed = true;
      return out;
    });
    if (changed) holder.images = shrunk;
  }
}

function startsWithToolResult(history) {
  const ctx = history[0]?.userInputMessage?.userInputMessageContext;
  return Array.isArray(ctx?.toolResults) && ctx.toolResults.length > 0;
}

// Drop history pairs from the front, then any leading user entry that carries
// toolResults whose assistant partner was just dropped (prevents orphaning).
function trimHistory(state) {
  while (state.history.length > 0 && payloadBytes(state) > KIRO_MAX_PAYLOAD_BYTES) {
    state.history.splice(0, Math.min(2, state.history.length));
    while (state.history.length > 0 && startsWithToolResult(state.history)) {
      state.history.shift();
    }
  }
  if (state.history.length === 0) delete state.history;
}

function dropImagesForSpace(payload, userInput) {
  if (!Array.isArray(userInput.images) || userInput.images.length === 0) return;
  let dropped = false;
  const kept = [...userInput.images].sort(
    (a, b) => textBytes(b?.source?.bytes) - textBytes(a?.source?.bytes)
  );
  while (kept.length > 0 && payloadBytes(payload) > KIRO_MAX_PAYLOAD_BYTES) {
    kept.shift();
    dropped = true;
    if (kept.length > 0) userInput.images = kept;
    else delete userInput.images;
  }
  if (
    dropped
    && typeof userInput.content === "string"
    && !userInput.content.includes(KIRO_IMAGE_DROP_NOTICE)
  ) {
    userInput.content += KIRO_IMAGE_DROP_NOTICE;
  }
}

function truncateToolResults(payload, userInput, excess) {
  const toolResults = userInput?.userInputMessageContext?.toolResults;
  if (!Array.isArray(toolResults) || toolResults.length === 0) return;
  const noticeBytes = textBytes(KIRO_TRUNCATION_NOTICE);
  let excessLeft = excess;
  let rounds = toolResults.length + 1;
  while (excessLeft > 0 && rounds-- > 0) {
    let largest = null;
    let largestSize = 0;
    for (const result of toolResults) {
      const size = (Array.isArray(result?.content) ? result.content : []).reduce(
        (sum, block) => sum + textBytes(block?.text),
        0
      );
      if (size > largestSize) {
        largestSize = size;
        largest = result;
      }
    }
    if (!largest || largestSize <= noticeBytes) break;
    for (const block of largest.content || []) {
      if (excessLeft <= 0) break;
      const original = typeof block?.text === "string" ? block.text : "";
      const size = textBytes(original);
      if (size === 0) continue;
      const keep = Math.max(0, size - excessLeft);
      block.text = cutBytes(original, keep) + KIRO_TRUNCATION_NOTICE;
      excessLeft -= size - keep;
    }
  }
}

function truncateContent(payload, userInput) {
  if (typeof userInput?.content !== "string" || userInput.content === "") return;
  const noticeBytes = textBytes(KIRO_TRUNCATION_NOTICE);
  const contentBytes = textBytes(userInput.content);
  // 1KiB headroom absorbs JSON escape inflation (e.g. \n → \\n) and marker drift.
  const keep = contentBytes - (payloadBytes(payload) - KIRO_MAX_PAYLOAD_BYTES) - noticeBytes - 1024;
  if (keep > 0 && keep < contentBytes) {
    userInput.content = cutBytes(userInput.content, keep) + KIRO_TRUNCATION_NOTICE;
  }
}

/**
 * Ported from cpa-kiro-provider (ViceEye) marshalKiroPayload/shrinkCurrentMessage:
 * degrade an oversized Kiro payload instead of letting upstream reject it.
 * Ladder: resize images → drop history pairs → drop images → truncate the
 * largest tool results → truncate the current content → hard fail.
 *
 * Pure function: the input body is never mutated (endpoint fallback calls
 * transformRequest once per URL on the same body, and the integrity-recovery
 * path re-sends a clone of the original), so the result must be recomputable.
 */
export function shrinkKiroPayload(body) {
  if (!body || typeof body !== "object") return body;
  if (payloadBytes(body) <= KIRO_MAX_PAYLOAD_BYTES) return body;

  const payload = structuredClone(body);
  const state = payload?.conversationState;
  const userInput = state?.currentMessage?.userInputMessage;

  resizeImages(payload);

  if (payloadBytes(payload) <= KIRO_MAX_PAYLOAD_BYTES) return payload;

  if (Array.isArray(state?.history) && state.history.length > 0) {
    trimHistory(state);
  }

  if (payloadBytes(payload) <= KIRO_MAX_PAYLOAD_BYTES || !userInput) {
    return assertWithinLimit(payload);
  }

  const excess = payloadBytes(payload) - KIRO_MAX_PAYLOAD_BYTES
    + textBytes(KIRO_TRUNCATION_NOTICE)
    + 1024;

  dropImagesForSpace(payload, userInput);
  truncateToolResults(payload, userInput, excess);
  truncateContent(payload, userInput);

  return assertWithinLimit(payload);
}

function assertWithinLimit(payload) {
  if (payloadBytes(payload) > KIRO_MAX_PAYLOAD_BYTES) {
    const error = new Error(
      `Kiro request exceeds the ${KIRO_MAX_PAYLOAD_BYTES}-byte payload limit after trimming`
    );
    error.code = "KIRO_PAYLOAD_LIMIT";
    throw error;
  }
  return payload;
}
