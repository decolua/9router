/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */

/**
 * Text carried by a Responses message item's `content` array.
 */
function messageItemText(item) {
  if (!Array.isArray(item?.content)) return "";
  return item.content
    .filter((c) => c && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
}

/**
 * Fold a terminal event's usage block into the accumulated state.
 */
function captureUsage(response, state) {
  if (!response?.usage) return;
  state.usage.input_tokens = response.usage.input_tokens || 0;
  state.usage.output_tokens = response.usage.output_tokens || 0;
  state.usage.total_tokens = response.usage.total_tokens || 0;
}

/**
 * Process a single SSE message and update state accordingly.
 */
function processSSEMessage(msg, state) {
  if (!msg.trim()) return;

  const eventMatch = msg.match(/^event:\s*(.+)$/m);
  const dataMatch = msg.match(/^data:\s*(.+)$/m);
  if (!eventMatch || !dataMatch) return;

  const eventType = eventMatch[1].trim();
  const dataStr = dataMatch[1].trim();
  if (dataStr === "[DONE]") return;

  let parsed;
  try { parsed = JSON.parse(dataStr); }
  catch { return; }

  if (eventType === "response.created") {
    state.responseId = parsed.response?.id || state.responseId;
    state.created = parsed.response?.created_at || state.created;
  } else if (eventType === "response.output_item.done") {
    state.items.set(parsed.output_index ?? 0, parsed.item);
  } else if (eventType === "response.output_text.delta") {
    // Some Responses-compatible upstreams stream the assistant text as deltas
    // and close the message item without it (or never emit the item at all), so
    // keep the deltas as the text source of last resort.
    const idx = Number.isInteger(parsed.output_index) ? parsed.output_index : 0;
    if (typeof parsed.delta === "string" && parsed.delta.length > 0) {
      state.textByIndex.set(idx, (state.textByIndex.get(idx) || "") + parsed.delta);
    }
  } else if (eventType === "response.completed" || eventType === "response.done") {
    state.status = "completed";
    state.terminal = true;
    captureUsage(parsed.response, state);
  } else if (eventType === "response.incomplete") {
    // The upstream stopped early (max_output_tokens / content filter). The answer
    // is truncated, but it IS how the upstream said it ended.
    state.status = "incomplete";
    state.terminal = true;
    captureUsage(parsed.response, state);
  } else if (eventType === "response.failed") {
    state.status = "failed";
    state.terminal = true;
  }
}

const EMPTY_RESPONSE = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

/**
 * Convert Responses API SSE stream to single JSON response
 * @param {ReadableStream} stream - SSE stream from provider
 * @returns {Promise<Object>} Final JSON response in Responses API format
 */
export async function convertResponsesStreamToJson(stream) {
  if (!stream || typeof stream.getReader !== "function") {
    return { id: `resp_${Date.now()}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "failed", terminal: false, output: [], usage: { ...EMPTY_RESPONSE } };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const state = {
    responseId: "",
    created: Math.floor(Date.now() / 1000),
    status: "in_progress",
    // Whether the upstream ever said how it ended (`response.completed` /
    // `response.done` / `response.incomplete` / `response.failed`). A stream that
    // just closes leaves `status` at whatever it last was — `in_progress` — which
    // is NOT an answer: a caller relaying that body hands the client an empty
    // completion it cannot tell apart from a legitimate empty one.
    terminal: false,
    usage: { ...EMPTY_RESPONSE },
    items: new Map(),
    // output_index → accumulated `response.output_text.delta` text
    textByIndex: new Map()
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || "";

      for (const msg of messages) {
        processSSEMessage(msg, state);
      }
    }

    // Flush remaining buffer (last event may not end with \n\n)
    if (buffer.trim()) {
      processSSEMessage(buffer, state);
    }
  } finally {
    reader.releaseLock();
  }

  // Build output array from accumulated items (ordered by index).
  // An index that only ever carried text deltas still produces a message item —
  // otherwise a client asking for JSON gets an empty `output` (and therefore an
  // empty completion) from an upstream that streams text without closing a
  // message item.
  const output = [];
  const indices = new Set(state.items.keys());
  for (const idx of state.textByIndex.keys()) indices.add(idx);
  const maxIndex = indices.size > 0 ? Math.max(...indices) : -1;
  for (let i = 0; i <= maxIndex; i++) {
    const item = state.items.get(i);
    const streamed = state.textByIndex.get(i) || "";
    if (!item) {
      output.push(streamed
        ? { type: "message", role: "assistant", content: [{ type: "output_text", text: streamed, annotations: [] }] }
        : { type: "message", content: [], role: "assistant" });
      continue;
    }
    // Fill a message item whose text never landed in the terminal item.
    if (item.type === "message" && !messageItemText(item) && streamed) {
      output.push({ ...item, content: [{ type: "output_text", text: streamed, annotations: [] }] });
      continue;
    }
    output.push(item);
  }

  return {
    id: state.responseId || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "response",
    created_at: state.created,
    status: state.status || "completed",
    // `status` is left at its upstream value (a Responses body may legitimately
    // be `in_progress`); this flag is what a consumer must check before treating
    // an empty `output` as an answer.
    terminal: state.terminal,
    output,
    usage: state.usage
  };
}
