/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */

// Extract visible text from a Responses message item.
function textFromMessageItem(item) {
  if (!item?.content || !Array.isArray(item.content)) return "";
  const byType = item.content.find((c) => c.type === "output_text");
  if (typeof byType?.text === "string") return byType.text;
  const anyText = item.content.find((c) => typeof c.text === "string");
  return typeof anyText?.text === "string" ? anyText.text : "";
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
    const index = parsed.output_index ?? 0;
    state.textDeltas.set(index, (state.textDeltas.get(index) || "") + (parsed.delta || ""));
  } else if (eventType === "response.output_text.done") {
    const index = parsed.output_index ?? 0;
    const text = parsed.text || state.textDeltas.get(index) || "";
    if (text && !state.items.has(index)) {
      state.items.set(index, { type: "message", role: "assistant", content: [{ type: "output_text", text }] });
    }
  } else if (eventType === "response.completed" || eventType === "response.done") {
    state.status = "completed";
    state.sawTerminal = true;
    if (parsed.response?.usage) {
      state.usage.input_tokens = parsed.response.usage.input_tokens || 0;
      state.usage.output_tokens = parsed.response.usage.output_tokens || 0;
      state.usage.total_tokens = parsed.response.usage.total_tokens || 0;
    }
    // Hydrate output from the terminal payload when granular output_item.done events
    // were absent (some providers only emit the final response.completed with output).
    if (Array.isArray(parsed.response?.output)) {
      parsed.response.output.forEach((item, i) => {
        if (item) state.items.set(i, item);
      });
    }
  } else if (eventType === "response.failed") {
    state.status = "failed";
    state.sawTerminal = true;
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
    return { id: `resp_${Date.now()}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "failed", output: [], usage: { ...EMPTY_RESPONSE }, empty: true };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const state = {
    responseId: "",
    created: Math.floor(Date.now() / 1000),
    status: "in_progress",
    usage: { ...EMPTY_RESPONSE },
    items: new Map(),
    textDeltas: new Map(),
    sawTerminal: false,
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

  // Materialize any accumulated text deltas even if the provider never sent
  // a matching output_text.done / response.completed payload.
  for (const [index, text] of state.textDeltas) {
    if (text && !state.items.has(index)) {
      state.items.set(index, {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      });
    }
  }

  // Build output array from accumulated items (ordered by index)
  const output = [];
  const maxIndex = state.items.size > 0 ? Math.max(...state.items.keys()) : -1;
  for (let i = 0; i <= maxIndex; i++) {
    output.push(state.items.get(i) || { type: "message", content: [], role: "assistant" });
  }

  // Flag streams that never produced output the client can use (no items and no
  // terminal event, or terminal but empty) so callers can surface a real error
  // instead of a silent 200 with `output: []`.
  const hasOutput = output.some((item) => {
    if (!item) return false;
    if (item.type === "message") return textFromMessageItem(item).length > 0;
    return true; // function_call / other non-empty structural items
  });
  const empty = !hasOutput;

  // If the stream closed without a terminal event and produced nothing, treat it as failed.
  const status = (!state.sawTerminal && empty) ? "failed" : (state.status || "completed");

  return {
    id: state.responseId || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "response",
    created_at: state.created,
    status,
    output,
    usage: state.usage,
    empty,
  };
}
