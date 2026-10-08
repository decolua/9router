import { FORMATS } from "../translator/formats.js";
import { fallbackToolCallId } from "../translator/concerns/toolCall.js";
import { buildErrorBody, detectErrorBody } from "./error.js";
import { SSE_DONE } from "./sseConstants.js";

const sharedEncoder = new TextEncoder();

// Parse SSE data line
export function parseSSELine(line, format = null) {
  if (!line) return null;

  // NDJSON format (Ollama): raw JSON lines without "data:" prefix
  if (format === FORMATS.OLLAMA) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  // Standard SSE format: "data: {...}"
  if (line.charCodeAt(0) !== 100) return null; // 'd' = 100

  const data = line.slice(5).trim();
  if (data === "[DONE]") return { done: true };

  try {
    return JSON.parse(data);
  } catch (error) {
    if (data.length > 0 && data.length < 1000) {
      console.log(`[WARN] Failed to parse SSE line (${data.length} chars): ${data.substring(0, 100)}...`);
    }
    return null;
  }
}

// Check if chunk has valuable content (not empty)
export function hasValuableContent(chunk, format) {
  // OpenAI format
  if (format === FORMATS.OPENAI && chunk.choices?.[0]?.delta) {
    const delta = chunk.choices[0].delta;
    return delta.content && delta.content !== "" ||
           delta.reasoning_content && delta.reasoning_content !== "" ||
           delta.tool_calls && delta.tool_calls.length > 0 ||
           chunk.choices[0].finish_reason ||
           delta.role;
  }

  // Claude format
  if (format === FORMATS.CLAUDE) {
    const isContentBlockDelta = chunk.type === "content_block_delta";
    const hasText = chunk.delta?.text && chunk.delta.text !== "";
    const hasThinking = chunk.delta?.thinking && chunk.delta.thinking !== "";
    const hasInputJson = chunk.delta?.partial_json && chunk.delta.partial_json !== "";
    
    if (isContentBlockDelta && !hasText && !hasThinking && !hasInputJson) {
      return false;
    }
    return true;
  }

  return true; // Other formats: keep all chunks
}

// Ensure every streamed tool_call carries an id.
//
// OpenAI's streaming contract: the id and function.name arrive on the FIRST
// fragment of a tool call; later fragments carry only `index` + argument
// deltas. Some providers instead open a brand-new `index` in a late fragment
// and omit the id entirely. Strict OpenAI-compatible clients
// (@ai-sdk/openai-compatible) then throw
// "AI_InvalidResponseDataError: Expected 'id' to be a string." and abort the
// whole turn.
//
// Fix: remember the id per tool-call index, and mint one when a fragment
// opens an index the client has not seen yet. The id must be stable for the
// rest of the call, so a later fragment with the same index reuses it.
//
// Returns true when a chunk was modified.
export function ensureStreamToolCallIds(chunk, seenIds) {
  if (!chunk?.choices?.length) return false;
  let changed = false;

  for (const choice of chunk.choices) {
    const calls = choice?.delta?.tool_calls;
    if (!Array.isArray(calls)) continue;

    for (const tc of calls) {
      if (!tc || typeof tc !== "object") continue;

      if (typeof tc.id === "string" && tc.id.length > 0) {
        if (tc.index !== undefined) seenIds.set(tc.index, tc.id);
        continue;
      }

      // No id on this fragment. Reuse the one already seen for this index, or
      // mint one when the index is new to the client.
      const known = tc.index !== undefined ? seenIds.get(tc.index) : undefined;
      const id = known || fallbackToolCallId(tc.index);
      tc.id = id;
      if (tc.index !== undefined) seenIds.set(tc.index, id);
      changed = true;
    }
  }

  return changed;
}

// Fix invalid id (generic or too short)
export function fixInvalidId(parsed) {
  if (parsed.id && (parsed.id === "chat" || parsed.id === "completion" || parsed.id.length < 8)) {
    const fallbackId = parsed.extend_fields?.requestId || 
                      parsed.extend_fields?.traceId || 
                      Date.now().toString(36);
    parsed.id = `chatcmpl-${fallbackId}`;
    return true;
  }
  return false;
}

function cleanUsagePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  let cleaned = payload;

  if ("usage" in cleaned) {
    if (cleaned.usage === null) {
      const { usage, ...payloadWithoutUsage } = cleaned;
      cleaned = payloadWithoutUsage;
    } else if (typeof cleaned.usage === "object" && cleaned.usage.perf_metrics === null) {
      const { perf_metrics, ...usageWithoutPerf } = cleaned.usage;
      cleaned = { ...cleaned, usage: usageWithoutPerf };
    }
  }

  if (cleaned.response && typeof cleaned.response === "object" && !Array.isArray(cleaned.response)) {
    const cleanedResponse = cleanUsagePayload(cleaned.response);
    if (cleanedResponse !== cleaned.response) {
      cleaned = { ...cleaned, response: cleanedResponse };
    }
  }

  return cleaned;
}

// Format output as SSE
export function formatSSE(data, sourceFormat) {
  if (data === null || data === undefined) return "data: null\n\n";
  if (data && data.done) return "data: [DONE]\n\n";

  // OpenAI Responses API format
  if (data && data.event && data.data) {
    const cleanedEventData = cleanUsagePayload(data.data);
    return `event: ${data.event}\ndata: ${JSON.stringify(cleanedEventData)}\n\n`;
  }

  data = cleanUsagePayload(data);

  // Claude format
  if (sourceFormat === FORMATS.CLAUDE && data && data.type) {
    return `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  return `data: ${JSON.stringify(data)}\n\n`;
}

// Terminal frames for a stream that aborted after HTTP 200 was already sent, so
// the status code can no longer change. OpenAI-compatible clients (openai-python
// raises APIError on any `data:` payload carrying an `error` key, checked before
// [DONE]) need the error frame first, then [DONE]; Anthropic clients need
// `event: error`. Never fabricate a successful finish_reason instead.
//
// Returns encoded bytes: onAbortTerminal callbacks are enqueued verbatim, same
// as buildAbortedResponsesTerminalBytes.
//
// NOTE: non-SSE client formats (Ollama NDJSON) get an SSE frame here — dead in
// practice because detectFormatByEndpoint never resolves to OLLAMA.
export function buildStreamErrorBytes(statusCode, message, clientFormat) {
  const { error: built } = buildErrorBody(statusCode, message);

  // OpenAI-compatible harnesses (Kilo CLI / opencode) only treat an in-stream
  // error as retryable when the error object has a string message, no `type`
  // field, and a numeric 4xx/5xx code. A string `type` blocks their envelope
  // synthesis, so the failure surfaces as a non-retryable UnknownError.
  const error = clientFormat === FORMATS.CLAUDE
    ? built
    : { message: built.message, code: statusCode };

  const sse = clientFormat === FORMATS.CLAUDE
    ? formatSSE({ type: "error", error }, FORMATS.CLAUDE)
    : formatSSE({ error }, clientFormat) + SSE_DONE;

  return sharedEncoder.encode(sse);
}

// Parse the first SSE event of an upstream stream. Returns the error descriptor
// when that event is an error frame (nested, flat, or a Responses failure),
// otherwise null. Only the first event is inspected — a later error is a
// mid-stream failure and cannot change the response status anymore.
export function parseFirstSseError(text) {
  const firstEvent = String(text || "").split("\n\n", 1)[0] || "";
  for (const line of firstEvent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let parsed;
    try { parsed = JSON.parse(payload); } catch { continue; }

    const error = detectErrorBody(parsed)
      || (parsed?.type === "response.failed" ? detectErrorBody(parsed.response?.error) : null);
    if (error) return error;
  }
  return null;
}

/**
 * Peek the first SSE event of an upstream body before piping it to the client.
 *
 * Relays and gateways answer a streaming request with an in-band error frame
 * (often before any content) when they are overloaded. Forwarding it leaves the
 * client with a mid-stream error it can only retry; surfacing it as a pre-flight
 * failure instead lets account fallback/retry run before any bytes are sent.
 *
 * Waits at most `timeoutMs` for the first event. Every byte read is replayed on
 * the returned response, so a healthy stream is never truncated.
 *
 * @returns {Promise<{error: {message: string, code?: string|number, type?: string} | null, response: Response|null}>}
 */
export async function peekSseErrorFrame(response, timeoutMs) {
  const body = response?.body;
  if (!body || !(timeoutMs > 0)) return { error: null, response };

  const reader = body.getReader();
  const chunks = [];
  const decoder = new TextDecoder();
  let text = "";
  let finished = false;
  // A read that outlived the deadline must be kept: the underlying stream queues
  // it, so dropping it would swallow the next chunk.
  let pendingRead = null;
  const deadline = Date.now() + timeoutMs;

  while (!text.includes("\n\n")) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), remaining); });
    let result;
    try {
      pendingRead = pendingRead || reader.read();
      result = await Promise.race([pendingRead, timeout]);
    } catch {
      finished = true;
      break;
    } finally {
      clearTimeout(timer);
    }

    if (result === "timeout") break;
    pendingRead = null;
    if (result.done) { finished = true; break; }
    chunks.push(result.value);
    text += decoder.decode(result.value, { stream: true });
  }

  const error = parseFirstSseError(text);
  if (error) {
    reader.cancel().catch(() => { });
    return { error, response: null };
  }

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    async pull(controller) {
      if (finished) { controller.close(); return; }
      try {
        const result = await (pendingRead || reader.read());
        pendingRead = null;
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => { });
    },
  });

  return {
    error: null,
    response: new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  };
}
