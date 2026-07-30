/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */
import {
  createResponsesAccumulator,
  finalizeResponsesAccumulator,
  reduceResponsesEvent
} from "../translator/concerns/responsesAccumulator.js";

/**
 * Process a single SSE message through the shared Responses reducer.
 */
function processSSEMessage(msg, accumulator) {
  if (!msg.trim()) return;

  const eventMatch = msg.match(/^event:\s*(.+)$/m);
  const dataMatch = msg.match(/^data:\s*(.+)$/m);
  if (!dataMatch) return;

  const dataStr = dataMatch[1].trim();
  if (dataStr === "[DONE]") return;

  let parsed;
  try { parsed = JSON.parse(dataStr); }
  catch { return; }
  reduceResponsesEvent(accumulator, {
    event: eventMatch?.[1]?.trim() || parsed.type,
    data: parsed
  });
}

const EMPTY_RESPONSE = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

/**
 * Convert Responses API SSE stream to single JSON response
 * @param {ReadableStream} stream - SSE stream from provider
 * @returns {Promise<Object>} Final JSON response in Responses API format
 */
export async function convertResponsesStreamToJson(stream) {
  const accumulator = createResponsesAccumulator();
  if (!stream || typeof stream.getReader !== "function") {
    const terminal = finalizeResponsesAccumulator(accumulator, {
      error: streamFailure("invalid_stream", "response stream is unavailable")
    });
    return { ...terminal.response, usage: { ...EMPTY_RESPONSE } };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let readError = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || "";

      for (const msg of messages) {
        processSSEMessage(msg, accumulator);
      }
    }

    // Flush remaining buffer (last event may not end with \n\n)
    if (buffer.trim()) {
      processSSEMessage(buffer, accumulator);
    }
  } catch (error) {
    readError = error;
  } finally {
    reader.releaseLock();
  }

  if (!accumulator.finalized) {
    finalizeResponsesAccumulator(accumulator, {
      error: streamFailure(
        readError ? "stream_read_error" : "stream_disconnected",
        readError?.message || "stream closed before a terminal response event"
      )
    });
  }

  const response = accumulator.terminalResponse;
  return { ...response, usage: response.usage || { ...EMPTY_RESPONSE } };
}

function streamFailure(code, message) {
  return { type: "stream_error", code, message };
}
