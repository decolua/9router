/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex, OpenCode Go)
 */

const EMPTY_RESPONSE = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

function createInitialState() {
  return {
    responseId: "",
    model: "",
    created: Math.floor(Date.now() / 1000),
    status: "in_progress",
    usage: { ...EMPTY_RESPONSE },
    items: new Map(),
    itemIdMap: new Map(),
    hasEvents: false,
    error: null,
  };
}

/**
 * Process a single SSE message and update state accordingly.
 */
function processSSEMessage(msg, state) {
  if (!msg.trim()) return;

  const lines = msg.split(/\r?\n/);
  let eventType = "";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) return;
  const dataStr = dataLines.join("\n");
  if (dataStr === "[DONE]") return;

  let parsed;
  try {
    parsed = JSON.parse(dataStr);
  } catch {
    return;
  }

  if (!eventType && parsed?.type) eventType = parsed.type;
  state.hasEvents = true;

  if (eventType === "response.created") {
    state.responseId = parsed.response?.id || parsed.id || state.responseId;
    state.created = parsed.response?.created_at || parsed.created_at || state.created;
    state.model = parsed.response?.model || parsed.model || state.model;
  } else if (eventType === "response.output_item.added") {
    const idx = parsed.output_index ?? state.items.size;
    if (parsed.item) {
      state.items.set(idx, { ...parsed.item });
      if (parsed.item.id) state.itemIdMap.set(parsed.item.id, idx);
    }
  } else if (eventType === "response.content_part.added") {
    const idx = parsed.output_index ?? 0;
    const item = state.items.get(idx) || { type: "message", role: "assistant", content: [] };
    if (!Array.isArray(item.content)) item.content = [];
    if (parsed.part) item.content.push({ ...parsed.part });
    state.items.set(idx, item);
  } else if (eventType === "response.output_text.delta") {
    const idx = parsed.output_index ?? (parsed.item_id ? state.itemIdMap.get(parsed.item_id) : 0) ?? 0;
    const item = state.items.get(idx) || { type: "message", role: "assistant", content: [] };
    if (!Array.isArray(item.content)) item.content = [];
    let textPart = item.content.find((c) => c?.type === "output_text");
    if (!textPart) {
      textPart = { type: "output_text", text: "" };
      item.content.push(textPart);
    }
    textPart.text = (textPart.text || "") + (parsed.delta || "");
    state.items.set(idx, item);
  } else if (eventType === "response.reasoning_summary_text.delta") {
    const idx = parsed.output_index ?? (parsed.item_id ? state.itemIdMap.get(parsed.item_id) : 0) ?? 0;
    const item = state.items.get(idx) || { type: "reasoning", summary: [] };
    if (!Array.isArray(item.summary)) item.summary = [];
    let summaryPart = item.summary.find((s) => s?.type === "summary_text");
    if (!summaryPart) {
      summaryPart = { type: "summary_text", text: "" };
      item.summary.push(summaryPart);
    }
    summaryPart.text = (summaryPart.text || "") + (parsed.delta || "");
    state.items.set(idx, item);
  } else if (eventType === "response.function_call_arguments.delta") {
    const idx = parsed.output_index ?? (parsed.item_id ? state.itemIdMap.get(parsed.item_id) : 0) ?? 0;
    const item = state.items.get(idx) || { type: "function_call", arguments: "" };
    item.arguments = (item.arguments || "") + (parsed.delta || "");
    state.items.set(idx, item);
  } else if (eventType === "response.output_item.done") {
    const idx = parsed.output_index ?? (parsed.item?.id ? state.itemIdMap.get(parsed.item.id) : null) ?? state.items.size;
    const existing = state.items.get(idx);
    const incoming = parsed.item;
    if (incoming) {
      if (existing) {
        if (incoming.type === "function_call" && !incoming.arguments && existing.arguments) {
          incoming.arguments = existing.arguments;
        }
        if (incoming.type === "message" && (!incoming.content || incoming.content.length === 0) && existing.content?.length > 0) {
          incoming.content = existing.content;
        }
      }
      state.items.set(idx, incoming);
      if (incoming.id) state.itemIdMap.set(incoming.id, idx);
    }
  } else if (eventType === "response.completed" || eventType === "response.done") {
    state.status = "completed";
    if (parsed.response?.id) state.responseId = parsed.response.id;
    if (parsed.response?.model) state.model = parsed.response.model;
    if (Array.isArray(parsed.response?.output) && parsed.response.output.length > 0) {
      parsed.response.output.forEach((outItem, i) => {
        const existing = state.items.get(i);
        if (!existing || (!existing.arguments && outItem.arguments) || (!existing.content?.length && outItem.content?.length)) {
          state.items.set(i, outItem);
        }
      });
    }
    if (parsed.response?.usage) {
      state.usage.input_tokens = parsed.response.usage.input_tokens || parsed.response.usage.prompt_tokens || 0;
      state.usage.output_tokens = parsed.response.usage.output_tokens || parsed.response.usage.completion_tokens || 0;
      state.usage.total_tokens = parsed.response.usage.total_tokens || (state.usage.input_tokens + state.usage.output_tokens);
      if (parsed.response.usage.input_tokens_details) {
        state.usage.input_tokens_details = parsed.response.usage.input_tokens_details;
      }
      if (parsed.response.usage.cache_read_input_tokens) {
        state.usage.cache_read_input_tokens = parsed.response.usage.cache_read_input_tokens;
      }
      if (parsed.response.usage.cache_creation_input_tokens) {
        state.usage.cache_creation_input_tokens = parsed.response.usage.cache_creation_input_tokens;
      }
    }
  } else if (eventType === "response.failed" || eventType === "error") {
    state.status = "failed";
    state.error = parsed.error || parsed.response?.error || { message: "Response failed" };
  }
}

function buildResponsesJsonObject(state, fallbackModel = "unknown") {
  const output = [];
  const maxIndex = state.items.size > 0 ? Math.max(...state.items.keys()) : -1;
  for (let i = 0; i <= maxIndex; i++) {
    if (state.items.has(i)) {
      output.push(state.items.get(i));
    } else {
      output.push({ type: "message", content: [], role: "assistant" });
    }
  }

  return {
    id: state.responseId || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "response",
    created_at: state.created,
    status: state.status || "completed",
    model: state.model || fallbackModel || "unknown",
    output,
    usage: state.usage,
    ...(state.error ? { error: state.error } : {}),
  };
}

/**
 * Convert Responses API SSE stream to single JSON response
 * @param {ReadableStream} stream - SSE stream from provider
 * @param {string} [fallbackModel="unknown"]
 * @returns {Promise<Object>} Final JSON response in Responses API format
 */
export async function convertResponsesStreamToJson(stream, fallbackModel = "unknown") {
  if (!stream || typeof stream.getReader !== "function") {
    return { id: `resp_${Date.now()}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "failed", output: [], usage: { ...EMPTY_RESPONSE } };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state = createInitialState();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split(/\r?\n\r?\n/);
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

  return buildResponsesJsonObject(state, fallbackModel);
}

/**
 * Parse raw Responses API SSE text into a single JSON response
 * @param {string} rawSSE - Raw SSE text
 * @param {string} [fallbackModel="unknown"]
 * @returns {Object|null} Final JSON response in Responses API format, or null if no valid events
 */
export function parseResponsesSSEToJSON(rawSSE, fallbackModel = "unknown") {
  if (!rawSSE || typeof rawSSE !== "string") return null;

  const state = createInitialState();
  const messages = rawSSE.split(/\r?\n\r?\n/);
  for (const msg of messages) {
    processSSEMessage(msg, state);
  }

  if (!state.hasEvents && state.items.size === 0) return null;
  return buildResponsesJsonObject(state, fallbackModel);
}
