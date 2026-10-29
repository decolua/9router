import { FORMATS } from "../translator/formats.js";
import { fallbackToolCallId } from "../translator/concerns/toolCall.js";
import { CLAUDE_EVENT, RESPONSES_EVENT_PREFIX } from "../translator/schema/index.js";
import { buildErrorBody } from "./error.js";
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

const nonEmpty = (v) => typeof v === "string" ? v.length > 0 : Array.isArray(v) && v.length > 0;

// True when a parsed upstream chunk carries generated output (text, thinking or
// tool-call arguments, or a Claude block that will carry them), in any provider
// format. Role-only openers, message_start,
// response.created, pings and usage trailers are not output — stream timing
// (TTFT, tok/s, max gap) is measured on output chunks only.
export function isOutputChunk(chunk) {
  if (!chunk || typeof chunk !== "object") return false;

  // OpenAI chat
  const delta = chunk.choices?.[0]?.delta;
  if (delta) {
    return nonEmpty(delta.content) || nonEmpty(delta.reasoning_content) ||
           nonEmpty(delta.reasoning) || nonEmpty(delta.tool_calls);
  }

  // Claude. A block start counts: with redacted thinking the thinking block opens
  // as soon as generation starts, but its tokens (billed in output_tokens) never
  // stream — the only delta is the signature when thinking ends.
  if (chunk.type === CLAUDE_EVENT.CONTENT_BLOCK_START) return true;
  if (chunk.type === CLAUDE_EVENT.CONTENT_BLOCK_DELTA) {
    const d = chunk.delta || {};
    return nonEmpty(d.text) || nonEmpty(d.thinking) || nonEmpty(d.partial_json);
  }

  // OpenAI Responses: every generated-output event is a non-empty response.*.delta
  if (typeof chunk.type === "string" && chunk.type.startsWith(RESPONSES_EVENT_PREFIX)) {
    return chunk.type.endsWith(".delta") && nonEmpty(chunk.delta);
  }

  // Gemini / Antigravity (the latter wraps the payload in `response`)
  const parts = (chunk.response || chunk).candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.some((p) => nonEmpty(p?.text) || p?.functionCall);
  }

  // Ollama
  const msg = chunk.message;
  if (msg) {
    return nonEmpty(msg.content) || nonEmpty(msg.thinking) || nonEmpty(msg.tool_calls);
  }

  return false;
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
  const { error } = buildErrorBody(statusCode, message);

  const sse = clientFormat === FORMATS.CLAUDE
    ? formatSSE({ type: "error", error }, FORMATS.CLAUDE)
    : formatSSE({ error }, clientFormat) + SSE_DONE;

  return sharedEncoder.encode(sse);
}
