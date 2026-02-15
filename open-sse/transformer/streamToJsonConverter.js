/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */

/**
 * Convert Responses API SSE stream to single JSON response
 * @param {ReadableStream} stream - SSE stream from provider
 * @returns {Promise<Object>} Final JSON response in Responses API format
 */
export async function convertResponsesStreamToJson(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let responseId = "";
  let output = [];
  let created = Math.floor(Date.now() / 1000);
  let status = "in_progress";
  let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  // Map of output_index -> item (for ordered output array)
  const items = new Map();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split by double newline (SSE event separator)
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || ""; // Keep incomplete message in buffer

      for (const msg of messages) {
        if (!msg.trim()) continue;

        // Parse SSE event
        const eventMatch = msg.match(/^event:\s*(.+)$/m);
        const dataMatch = msg.match(/^data:\s*(.+)$/m);

        if (!eventMatch || !dataMatch) continue;

        const eventType = eventMatch[1].trim();
        const dataStr = dataMatch[1].trim();

        if (dataStr === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          // Skip malformed JSON
          continue;
        }

        // Handle different event types
        if (eventType === "response.created") {
          responseId = parsed.response?.id || responseId;
          created = parsed.response?.created_at || created;
        }
        else if (eventType === "response.output_item.done") {
          const idx = parsed.output_index ?? 0;
          items.set(idx, parsed.item);
        }
        else if (eventType === "response.completed") {
          status = "completed";
          if (parsed.response?.usage) {
            usage.input_tokens = parsed.response.usage.input_tokens || 0;
            usage.output_tokens = parsed.response.usage.output_tokens || 0;
            usage.total_tokens = parsed.response.usage.total_tokens || 0;
          }
        }
        else if (eventType === "response.failed") {
          status = "failed";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Build output array from accumulated items (ordered by index)
  const maxIndex = items.size > 0 ? Math.max(...items.keys()) : -1;
  for (let i = 0; i <= maxIndex; i++) {
    output.push(items.get(i) || {
      type: "message",
      content: [],
      role: "assistant"
    });
  }

  return {
    id: responseId || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "response",
    created_at: created,
    status: status || "completed",
    output,
    usage
  };
}
