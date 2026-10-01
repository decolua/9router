// RTK port: compress tool_result content in LLM request bodies
// Applied in chatCore on the source-format body, before translateRequest.
import { RAW_CAP, MIN_COMPRESS_SIZE, hasTruncationSentinel, stripTruncationSentinels } from "./constants.js";
import { autoDetectFilter } from "./autodetect.js";
import { safeApply } from "./applyFilter.js";

// Compress tool_result content in-place. Returns stats or null if disabled/failed.
export function compressMessages(body, enabled) {
  if (!enabled) return null;
  if (!body) return null;

  // Kiro format: conversationState.history + conversationState.currentMessage
  if (body.conversationState) {
    return compressKiroFormat(body, enabled);
  }

  // Support both OpenAI/Claude "messages" and OpenAI Responses "input"
  const items = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!items) return null;

  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  // Strip any sentinel literal an untrusted tool result carries as DATA, before
  // the per-shape walk (which may return early for small content). Otherwise a
  // forged marker in tool output would survive to the model as trusted metadata.
  // EXCEPTION: content that already carries our sentinel on its own final line
  // is a previously compressed result (idempotency) — leave it exactly as-is.
  // A sentinel EMBEDDED mid-content is untrusted data and gets stripped.
  const TAIL_SENTINEL = /\n?\[RTK-TRUNCATED [^\]]*\]\s*$/;
  const cleanField = (s) => {
    if (typeof s !== "string") return s;
    if (TAIL_SENTINEL.test(s)) return s; // genuine, already-compressed result
    return stripTruncationSentinels(s);
  };
  for (const msg of items) {
    if (!msg || typeof msg !== "object") continue;
    if (typeof msg.content === "string") msg.content = cleanField(msg.content);
    if (typeof msg.output === "string") msg.output = cleanField(msg.output);
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && typeof part.text === "string") part.text = cleanField(part.text);
        if (part && typeof part.content === "string") part.content = cleanField(part.content);
      }
    }
  }
  try {
    for (let i = 0; i < items.length; i++) {
      const msg = items[i];
      if (!msg) continue;

      // Shape 4: OpenAI Responses — top-level { type:"function_call_output", output: string | [{type:"input_text", text}] }
      if (msg.type === "function_call_output") {
        if (typeof msg.output === "string") {
          msg.output = compressText(msg.output, stats, "openai-responses-string");
        } else if (Array.isArray(msg.output)) {
          for (let k = 0; k < msg.output.length; k++) {
            const part = msg.output[k];
            if (part && part.type === "input_text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "openai-responses-array");
            }
          }
        }
        continue;
      }

      // Shape 1: OpenAI tool message — { role:"tool", content: "string" }
      // This is the shape the Claude->OpenAI translator emits (string content),
      // so the [tool_error: true] marker check MUST live here too — otherwise a
      // failed tool result gets compressed and its error trace is lost.
      if (msg.role === "tool" && typeof msg.content === "string") {
        if (msg.content.startsWith("[tool_error: true]")) continue;
        msg.content = compressText(msg.content, stats, "openai-tool");
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // Shape 1b: OpenAI tool message — { role:"tool", content:[{type:"text", text:"..."}] }
      if (msg.role === "tool") {
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k];
          if (part && part.type === "text" && typeof part.text === "string") {
            // An error result carries the [tool_error: true] marker the Claude->
            // OpenAI translator prepends; never compress error traces.
            if (part.text.startsWith("[tool_error: true]")) continue;
            part.text = compressText(part.text, stats, "openai-tool-array");
          }
        }
        continue;
      }

      // Shape 2/3: blocks array with tool_result entries
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (!block || block.type !== "tool_result") continue;
        if (block.is_error === true) continue; // preserve error traces

        if (typeof block.content === "string") {
          // Shape 2: claude string form
          block.content = compressText(block.content, stats, "claude-string");
        } else if (Array.isArray(block.content)) {
          // Shape 3: claude array form — compress each text part
          for (let k = 0; k < block.content.length; k++) {
            const part = block.content[k];
            if (part && part.type === "text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "claude-array");
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressMessages error:", e.message);
    return null;
  }
  return stats;
}

// Compress Kiro format: conversationState.history[].userInputMessage.userInputMessageContext.toolResults[].content[].text
function compressKiroFormat(body, enabled) {
  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    const state = body.conversationState;
    const allMessages = [...(Array.isArray(state?.history) ? state.history : [])];
    if (state?.currentMessage) allMessages.push(state.currentMessage);

    for (const msg of allMessages) {
      const toolResults = msg?.userInputMessage?.userInputMessageContext?.toolResults;
      if (!Array.isArray(toolResults)) continue;

      for (const tr of toolResults) {
        if (tr.status === "error") continue; // preserve error traces
        if (!Array.isArray(tr.content)) continue;

        for (const part of tr.content) {
          if (part && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "kiro-tool-result");
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressKiroFormat error:", e.message);
    return null;
  }
  return stats;
}

function compressText(text, stats, shape) {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;

  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  // Idempotency: an already-compressed result carries a sentinel; do not run a
  // filter over it again (which could re-truncate or stack markers).
  if (hasTruncationSentinel(text)) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  // Untrusted tool output may contain a forged sentinel literal; strip it before
  // any filter runs so only the real, computed marker reaches the model.
  const sanitized = stripTruncationSentinels(text);
  const fn = autoDetectFilter(sanitized);
  if (!fn) {
    stats.bytesAfter += sanitized.length;
    return sanitized;
  }

  const out = safeApply(fn, sanitized);

  // Safety: never return empty, never grow the input
  if (!out || out.length === 0 || out.length >= bytesIn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  stats.bytesAfter += out.length;
  stats.hits.push({ shape, filter: fn.filterName || fn.name, saved: bytesIn - out.length });
  return out;
}

// Convenience: format a log line from stats
export function formatRtkLog(stats) {
  if (!stats || !stats.hits || stats.hits.length === 0) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
  const filters = Array.from(new Set(stats.hits.map(h => h.filter))).join(",");
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}
