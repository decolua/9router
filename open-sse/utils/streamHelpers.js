import { FORMATS } from "../translator/formats.js";
import { fallbackToolCallId } from "../translator/concerns/toolCall.js";
import { buildErrorBody, detectErrorBody, normalizeErrorMessage } from "./error.js";
import { SSE_DONE } from "./sseConstants.js";
import { CLAUDE_BLOCK, RESPONSES_ITEM } from "../translator/schema/blocks.js";
import { CLAUDE_EVENT, RESPONSES_EVENT } from "../translator/schema/streamEvents.js";
import { RESPONSES_STATUS } from "../translator/schema/finishReasons.js";
import { STREAM_FAILURE_MESSAGES } from "../config/errorConfig.js";

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
  if (format === FORMATS.OPENAI && Array.isArray(chunk.choices) && chunk.choices.length > 0) {
    return hasStreamOutput(chunk) || chunk.choices.some((choice) => choice?.delta?.role);
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
  const { eventName, data } = readSseFields(String(text || "").split(/\r?\n\r?\n/, 1)[0] || "");
  try { return detectSseEventError(JSON.parse(data), eventName); } catch { return null; }
}

export function readSseFields(event) {
  let eventName;
  const data = [];
  for (const line of event.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { eventName, data: data.join("\n").trim() };
}

// Metadata and keepalives do not satisfy the first-output deadline. A tool
// identity or reasoning payload is usable even before the first text token.
export function hasStreamOutput(chunk, eventName) {
  if (!chunk || typeof chunk !== "object") return false;
  if (Array.isArray(chunk.choices)) {
    return chunk.choices.some((choice) => {
      const delta = choice?.delta || choice?.message || {};
      return Boolean(choice?.finish_reason || choice?.text || delta.content || delta.refusal
        || delta.reasoning_content || delta.reasoning || delta.reasoning_details?.length
        || delta.tool_calls?.length || delta.function_call || delta.audio?.data);
    });
  }
  const type = eventName || chunk.type;
  switch (type) {
    case CLAUDE_EVENT.MESSAGE_START:
    case CLAUDE_EVENT.MESSAGE_DELTA:
    case CLAUDE_EVENT.CONTENT_BLOCK_STOP:
    case CLAUDE_EVENT.PING:
    case RESPONSES_EVENT.CREATED:
    case RESPONSES_EVENT.IN_PROGRESS:
    case RESPONSES_EVENT.QUEUED:
      return false;
    case CLAUDE_EVENT.MESSAGE_STOP:
    case RESPONSES_EVENT.COMPLETED:
    case RESPONSES_EVENT.DONE:
    case RESPONSES_EVENT.INCOMPLETE:
      return true;
    case CLAUDE_EVENT.CONTENT_BLOCK_START: {
      const block = chunk.content_block;
      return Boolean(block?.text || block?.thinking || block?.id || block?.type === CLAUDE_BLOCK.TOOL_USE);
    }
    case CLAUDE_EVENT.CONTENT_BLOCK_DELTA:
      return Boolean(chunk.delta?.text || chunk.delta?.thinking || chunk.delta?.partial_json);
    case RESPONSES_EVENT.OUTPUT_ITEM_ADDED:
    case RESPONSES_EVENT.OUTPUT_ITEM_DONE: {
      const { item } = chunk;
      return Boolean(item && (item.type !== RESPONSES_ITEM.MESSAGE && item.type !== RESPONSES_ITEM.REASONING
        || item.content?.length || item.summary?.length || item.encrypted_content));
    }
    case RESPONSES_EVENT.CONTENT_PART_ADDED:
    case RESPONSES_EVENT.REASONING_SUMMARY_PART_ADDED:
      return Boolean(chunk.part?.text || chunk.part?.refusal);
  }
  if (typeof chunk.delta === "string" && chunk.delta.length > 0) return true;
  if (chunk.response?.status === RESPONSES_STATUS.COMPLETED || chunk.response?.status === RESPONSES_STATUS.INCOMPLETE) return true;
  const candidates = chunk.candidates ?? chunk.response?.candidates;
  if (Array.isArray(candidates)) {
    return candidates.some((candidate) => candidate?.finishReason || candidate?.content?.parts?.some?.(
      (part) => part?.text || part?.functionCall || part?.inlineData,
    ));
  }
  return Boolean(chunk.done === true || chunk.message?.content || chunk.message?.thinking || chunk.message?.tool_calls?.length
    || chunk.text || chunk.content || chunk.tool_calls?.length || typeof chunk.response === "string" && chunk.response);
}

/** Error descriptor of one parsed SSE event (flat, nested or Responses `response.failed`), else null. */
export function detectSseEventError(parsed, eventName) {
  const type = eventName || parsed?.type;
  if (type === RESPONSES_EVENT.FAILED || parsed?.response?.status === RESPONSES_STATUS.FAILED) {
    return detectErrorBody({ error: parsed?.response?.error }) || detectErrorBody(parsed) || { message: "Upstream response failed" };
  }
  return detectErrorBody(parsed) || (type === "error"
    ? { message: normalizeErrorMessage(parsed) || STREAM_FAILURE_MESSAGES.reported }
    : null);
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
