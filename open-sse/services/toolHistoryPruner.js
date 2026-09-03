/**
 * Tool history pruner — cap tool-turn growth and truncate oversized tool_results.
 * Fail-open: any error returns null and leaves body untouched.
 *
 * Handles: OpenAI (role:"tool", role:"assistant" + tool_calls, content blocks),
 *          Claude (content: [{type:"tool_result"/"tool_use"}]),
 *          Responses (input: [{type:"function_call_output"}]),
 *          Kiro (conversationState.history[].userInputMessage.toolResults).
 *
 * Settings shape (all optional):
 *   { enabled?: boolean, maxToolTurns?: number, maxCharsPerResult?: number, preserveErrors?: boolean, maxTotalChars?: number }
 */

const DEFAULTS = {
  enabled: false, // conservative default: off until user opts in
  maxToolTurns: 20,
  maxCharsPerResult: 50000,
  maxTotalChars: 200000,
  preserveErrors: true,
};

function isToolTurn(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (msg.role === "tool" || msg.role === "function") return true;
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true;
  if (Array.isArray(msg.content)) {
    return msg.content.some((b) => b?.type === "tool_result" || b?.type === "tool_use");
  }
  if (msg.type === "function_call_output") return true;
  return false;
}

function isErrorBlock(block) {
  if (!block || typeof block !== "object") return false;
  return block.is_error === true || block.status === "error";
}

function truncateText(text, maxChars) {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head - 40;
  return `${text.slice(0, head)}\n\n[... truncated ${text.length - maxChars} chars ...]\n\n${text.slice(-tail)}`;
}

function truncateToolResultBlocks(blocks, maxChars, preserveErrors) {
  let saved = 0;
  for (const block of blocks) {
    if (!block || block.type !== "tool_result") continue;
    if (preserveErrors && isErrorBlock(block)) continue;
    if (typeof block.content === "string") {
      if (block.content.length > maxChars) {
        const before = block.content.length;
        block.content = truncateText(block.content, maxChars);
        saved += before - block.content.length;
      }
    } else if (Array.isArray(block.content)) {
      for (const part of block.content) {
        if (part?.type === "text" && typeof part.text === "string" && part.text.length > maxChars) {
          const before = part.text.length;
          part.text = truncateText(part.text, maxChars);
          saved += before - part.text.length;
        }
      }
    }
  }
  return saved;
}

function pruneMessagesArray(messages, opts, stats) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  // 1) Truncate oversized individual tool results
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role === "tool" && typeof msg.content === "string") {
      if (msg.content.length > opts.maxCharsPerResult) {
        const before = msg.content.length;
        msg.content = truncateText(msg.content, opts.maxCharsPerResult);
        stats.bytesSaved += before - msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === "text" && typeof part.text === "string" && part.text.length > opts.maxCharsPerResult) {
            const before = part.text.length;
            part.text = truncateText(part.text, opts.maxCharsPerResult);
            stats.bytesSaved += before - part.text.length;
          }
        }
      }
    }
    if (Array.isArray(msg.content)) {
      stats.bytesSaved += truncateToolResultBlocks(msg.content, opts.maxCharsPerResult, opts.preserveErrors);
    }
    if (msg.type === "function_call_output") {
      if (typeof msg.output === "string" && msg.output.length > opts.maxCharsPerResult) {
        const before = msg.output.length;
        msg.output = truncateText(msg.output, opts.maxCharsPerResult);
        stats.bytesSaved += before - msg.output.length;
      } else if (Array.isArray(msg.output)) {
        for (const part of msg.output) {
          if (part?.type === "input_text" && typeof part.text === "string" && part.text.length > opts.maxCharsPerResult) {
            const before = part.text.length;
            part.text = truncateText(part.text, opts.maxCharsPerResult);
            stats.bytesSaved += before - part.text.length;
          }
        }
      }
    }
  }

  // 2) Cap number of tool turns: keep newest maxToolTurns, drop oldest (middle) ones.
  // Preserve leading system messages and trailing user run; drop middle tool history first.
  const toolIndices = [];
  messages.forEach((m, i) => { if (isToolTurn(m)) toolIndices.push(i); });
  if (toolIndices.length <= opts.maxToolTurns) return;

  const toDrop = toolIndices.length - opts.maxToolTurns;
  // Drop oldest tool turns (lowest indices) that are not errors when preserveErrors
  let dropped = 0;
  const dropSet = new Set();
  for (const idx of toolIndices) {
    if (dropped >= toDrop) break;
    const msg = messages[idx];
    // Skip error tool turns if preserveErrors
    if (opts.preserveErrors) {
      const hasError = Array.isArray(msg.content) && msg.content.some(isErrorBlock);
      if (hasError) continue;
      if (msg.role === "tool" && typeof msg.content === "string" && msg.content.toLowerCase().includes("error")) {
        // heuristic: don't drop likely error, keep
        continue;
      }
    }
    dropSet.add(idx);
    dropped++;
  }
  // If preserveErrors prevented enough drops, fall back to dropping oldest regardless
  if (dropped < toDrop) {
    for (const idx of toolIndices) {
      if (dropped >= toDrop) break;
      if (dropSet.has(idx)) continue;
      dropSet.add(idx);
      dropped++;
    }
  }

  // Filter out dropped indices (in-place splice from end to keep indices stable)
  const sortedDrop = [...dropSet].sort((a, b) => b - a);
  for (const idx of sortedDrop) {
    const removed = messages[idx];
    const sz = JSON.stringify(removed || "").length;
    stats.bytesSaved += sz;
    stats.prunedCount++;
    messages.splice(idx, 1);
  }

  // 3) Global total char cap: if still over maxTotalChars, summarize oldest remaining tool turns
  if (opts.maxTotalChars && opts.maxTotalChars > 0) {
    let totalChars = JSON.stringify(messages).length;
    let i = 0;
    while (totalChars > opts.maxTotalChars && i < messages.length) {
      const msg = messages[i];
      if (isToolTurn(msg) && !dropSet.has(i)) {
        // Replace large tool result with summary marker
        const placeholder = "[Tool output pruned: exceeded context budget]";
        if (msg.role === "tool" && typeof msg.content === "string") {
          if (msg.content.length > 200) {
            const before = msg.content.length;
            msg.content = `${msg.content.slice(0, 200)}\n${placeholder}`;
            const saved = before - msg.content.length;
            stats.bytesSaved += saved;
            totalChars -= saved;
          }
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block?.type === "tool_result" && typeof block.content === "string" && block.content.length > 200) {
              const before = block.content.length;
              block.content = `${block.content.slice(0, 200)}\n${placeholder}`;
              const saved = before - block.content.length;
              stats.bytesSaved += saved;
              totalChars -= saved;
            }
          }
        }
      }
      i++;
      if (i >= messages.length) break;
    }
  }
}

function pruneKiro(state, opts, stats) {
  const all = [...(Array.isArray(state?.history) ? state.history : [])];
  if (state?.currentMessage) all.push(state.currentMessage);
  // Truncate toolResults text
  for (const item of all) {
    const toolResults = item?.userInputMessage?.userInputMessageContext?.toolResults;
    if (!Array.isArray(toolResults)) continue;
    for (const tr of toolResults) {
      if (opts.preserveErrors && tr.status === "error") continue;
      if (!Array.isArray(tr.content)) continue;
      for (const part of tr.content) {
        if (typeof part?.text === "string" && part.text.length > opts.maxCharsPerResult) {
          const before = part.text.length;
          part.text = truncateText(part.text, opts.maxCharsPerResult);
          stats.bytesSaved += before - part.text.length;
        }
      }
    }
  }
  // Cap tool turns (history items that contain toolResults) — drop oldest
  const toolItemIndices = [];
  const hist = state.history || [];
  hist.forEach((item, i) => {
    if (item?.userInputMessage?.userInputMessageContext?.toolResults?.length) toolItemIndices.push(i);
  });
  if (toolItemIndices.length > opts.maxToolTurns) {
    const toDrop = toolItemIndices.length - opts.maxToolTurns;
    let dropped = 0;
    for (const idx of toolItemIndices) {
      if (dropped >= toDrop) break;
      const item = hist[idx];
      const isErr = item?.userInputMessage?.userInputMessageContext?.toolResults?.some((tr) => tr.status === "error");
      if (opts.preserveErrors && isErr) continue;
      dropped++;
    }
    if (dropped < toDrop) {
      // fallback: drop oldest regardless
      for (let k = dropped; k < toDrop; k++) {
        const idx = toolItemIndices[k];
        const removed = hist[idx];
        stats.bytesSaved += JSON.stringify(removed || "").length;
        stats.prunedCount++;
        hist.splice(idx - (k - dropped), 1);
      }
    } else {
      // remove marked indices from end
      const dropSet = new Set(toolItemIndices.slice(0, dropped));
      let offset = 0;
      for (let i = 0; i < hist.length; ) {
        if (dropSet.has(i + offset)) {
          const removed = hist[i];
          stats.bytesSaved += JSON.stringify(removed || "").length;
          stats.prunedCount++;
          hist.splice(i, 1);
          offset++;
        } else i++;
      }
    }
  }
}

/**
 * Prune tool history in-place.
 * @param {object} body - translatedBody (mutated in place)
 * @param {object} config - { enabled, maxToolTurns, maxCharsPerResult, maxTotalChars, preserveErrors }
 * @returns {{prunedCount:number, bytesSaved:number, beforeChars:number}|null}
 */
export function pruneToolHistory(body, config) {
  if (!body || typeof body !== "object") return null;
  const opts = { ...DEFAULTS, ...(config || {}) };
  if (!opts.enabled) return null;
  try {
    const beforeChars = JSON.stringify(body).length;
    const stats = { prunedCount: 0, bytesSaved: 0 };

    if (body.conversationState && typeof body.conversationState === "object") {
      pruneKiro(body.conversationState, opts, stats);
    } else if (Array.isArray(body.messages)) {
      pruneMessagesArray(body.messages, opts, stats);
    } else if (Array.isArray(body.input)) {
      pruneMessagesArray(body.input, opts, stats);
    } else if (Array.isArray(body.contents)) {
      // Gemini format: contents[].parts may contain tool-like blocks; treat similarly
      pruneMessagesArray(body.contents, opts, stats);
    } else {
      return null;
    }

    const afterChars = JSON.stringify(body).length;
    const out = { prunedCount: stats.prunedCount, bytesSaved: Math.max(0, beforeChars - afterChars), beforeChars, afterChars };
    return out.prunedCount > 0 || out.bytesSaved > 500 ? out : null;
  } catch (e) {
    console.warn("[pruner] error:", e.message);
    return null;
  }
}

export function formatPrunerLog(stats) {
  if (!stats) return null;
  if (!stats.prunedCount && stats.bytesSaved < 500) return null;
  const pct = stats.beforeChars > 0 ? ((stats.bytesSaved / stats.beforeChars) * 100).toFixed(1) : "0";
  return `[PRUNER] pruned ${stats.prunedCount} tool turns, saved ${stats.bytesSaved}B / ${stats.beforeChars}B (${pct}%)`;
}

export const PRUNER_DEFAULTS = DEFAULTS;
