// TOON: lossless JSON→compact tabular notation
// Applied independently from RTK as a universal token saver.
import { encode } from "@toon-format/toon";
import { RAW_CAP, MIN_COMPRESS_SIZE } from "./constants.js";

export function tryToon(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  try {
    const toon = encode(parsed, { indent: 2 });
    if (toon && toon.length > 0 && toon.length < trimmed.length) {
      return toon;
    }
  } catch {
    // ignore encoding errors
  }
  return null;
}

// Compress JSON tool_result content in-place. Returns stats or null if disabled/failed.
// Mirrors the message-shape traversal in RTK compressMessages.
export function applyToon(body, enabled) {
  if (!enabled) return null;
  if (!body) return null;
  const items = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!items) return null;

  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    for (let i = 0; i < items.length; i++) {
      const msg = items[i];
      if (!msg) continue;

      if (msg.type === "function_call_output") {
        if (typeof msg.output === "string") {
          msg.output = compressTextToon(msg.output, stats, "openai-responses-string");
        } else if (Array.isArray(msg.output)) {
          for (let k = 0; k < msg.output.length; k++) {
            const part = msg.output[k];
            if (part && part.type === "input_text" && typeof part.text === "string") {
              part.text = compressTextToon(part.text, stats, "openai-responses-array");
            }
          }
        }
        continue;
      }

      if (msg.role === "tool" && typeof msg.content === "string") {
        msg.content = compressTextToon(msg.content, stats, "openai-tool");
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      if (msg.role === "tool") {
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k];
          if (part && part.type === "text" && typeof part.text === "string") {
            part.text = compressTextToon(part.text, stats, "openai-tool-array");
          }
        }
        continue;
      }

      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (!block || block.type !== "tool_result") continue;
        if (block.is_error === true) continue;

        if (typeof block.content === "string") {
          block.content = compressTextToon(block.content, stats, "claude-string");
        } else if (Array.isArray(block.content)) {
          for (let k = 0; k < block.content.length; k++) {
            const part = block.content[k];
            if (part && part.type === "text" && typeof part.text === "string") {
              part.text = compressTextToon(part.text, stats, "claude-array");
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[TOON] applyToon error:", e.message);
    return null;
  }
  return stats;
}

function compressTextToon(text, stats, shape) {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;

  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const out = tryToon(text);
  if (out && out.length > 0 && out.length < bytesIn) {
    stats.bytesAfter += out.length;
    stats.hits.push({ shape, filter: "toon", saved: bytesIn - out.length });
    return out;
  }

  stats.bytesAfter += bytesIn;
  return text;
}

export function formatToonLog(stats) {
  if (!stats || !stats.hits || stats.hits.length === 0) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
  return `[TOON] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) hits=${stats.hits.length}`;
}
