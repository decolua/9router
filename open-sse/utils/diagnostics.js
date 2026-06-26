// Diagnostics for empty / malformed HTTP 200 responses.
// Used by streaming + non-streaming handlers to log one structured line and
// synthesize a client-shaped error payload instead of a silent empty body.
// Reuses formatIncompleteOpenAIResponsesStreamFailure for Responses clients.
import { formatIncompleteOpenAIResponsesStreamFailure } from "./responsesStreamHelpers.js";

// Human-readable reason text surfaced to the client + logs.
const REASON_MESSAGES = {
  empty: "no content produced",
  stall: "stream stalled (no data within the stall window)",
  abort: "stream aborted",
  client_closed: "client closed the connection",
  no_terminal: "stream closed without a terminal event",
  parse_fail: "failed to parse upstream stream",
  empty_choices: "response had no usable choices/output",
  empty_stream: "upstream stream carried no content",
};

function describeReason(reason) {
  return REASON_MESSAGES[reason] || reason || "empty response";
}

function emptyResponseMessage({ provider, reason }) {
  return `[${provider || "?"}] returned an empty response (${describeReason(reason)}). ` +
    "Likely quota exhaustion, an overloaded upstream, or a proxy/gateway intercepting the stream.";
}

/**
 * Log one structured [MALFORMED-200] line. Noop-safe (any field optional).
 * Surfaced to stdout so it is grep/SQL-correlatable with requestDetails.
 */
export function reportMalformed200({
  mode, provider, model, connectionId, reason,
  recvBytes, recvLines, emitted, events, ttftMs, elapsedMs,
}) {
  const evt = events && typeof events === "object"
    ? `[${Object.entries(events).map(([k, v]) => `${k}=${v}`).join(",")}]`
    : "[]";
  console.log(
    `[MALFORMED-200] mode=${mode || "?"} provider=${provider || "?"} model=${model || "?"} ` +
    `conn=${connectionId || "-"} reason=${reason || "empty"} recvBytes=${recvBytes ?? -1} ` +
    `recvLines=${recvLines ?? -1} emitted=${emitted ?? -1} events=${evt} ` +
    `ttft=${ttftMs ?? -1}ms dur=${elapsedMs ?? -1}ms`,
  );
}

/**
 * Streaming chat-completion error chunk (SSE text) for an empty stream.
 * Caller enqueues this before the terminal `data: [DONE]`.
 * Keeps finish_reason:"stop" + adds `error` for broad client compatibility.
 */
export function synthOpenAIErrorChunk({ provider, model, reason }) {
  const body = {
    id: `chatcmpl-empty-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model || "unknown",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    error: {
      message: emptyResponseMessage({ provider, reason }),
      type: "upstream_empty_response",
    },
  };
  return `data: ${JSON.stringify(body)}\n\n`;
}

/** Claude Messages API failure events (SSE text) for an empty stream. */
export function synthClaudeErrorEvents({ provider, model, reason }) {
  const message = emptyResponseMessage({ provider, reason });
  const id = `msg_empty_${Date.now()}`;
  const events = [
    {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: model || "unknown",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: message },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 0 },
    },
    { type: "message_stop" },
  ];
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

/**
 * Responses-API failure event (SSE text) for an empty/aborted passthrough stream.
 * Wraps the shared terminal helper so reasons stay consistent.
 */
export function synthResponsesFailure(reason) {
  return formatIncompleteOpenAIResponsesStreamFailure(describeReason(reason));
}

export const __test = { describeReason };
