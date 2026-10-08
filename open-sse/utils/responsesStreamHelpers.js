// Helpers for OpenAI Responses API streaming termination + event framing
import { FORMATS } from "../translator/formats.js";
import { formatSSE } from "./streamHelpers.js";
import { normalizeErrorMessage, isTransientStreamError } from "./error.js";

// Responses API events that signal the stream has reached a terminal state
const OPENAI_RESPONSES_TERMINAL_EVENTS = new Set([
  "response.completed",
  "response.done",
  "response.failed",
  "error"
]);

export function getOpenAIResponsesEventName(eventName, chunk) {
  if (eventName) return eventName;
  if (chunk && typeof chunk.type === "string") return chunk.type;
  return null;
}

export function isOpenAIResponsesTerminalEvent(eventName, chunk) {
  const type = getOpenAIResponsesEventName(eventName, chunk);
  if (OPENAI_RESPONSES_TERMINAL_EVENTS.has(type)) return true;
  const status = chunk?.response?.status;
  return status === "completed" || status === "failed";
}

const sharedEncoder = new TextEncoder();

// Encoded response.failed + [DONE] payload for aborted/stalled Responses passthrough streams
export function buildAbortedResponsesTerminalBytes() {
  return sharedEncoder.encode(`${formatIncompleteOpenAIResponsesStreamFailure()}data: [DONE]\n\n`);
}

// Canonicalize an upstream error payload for stream clients. Upstreams emit
// errors flat (`{ message, type, code }`), nested, or double-encoded, and clients
// that cannot classify the shape surface them as a non-retryable "unknown error".
//
// Harness stream-error parsers (Kilo CLI / opencode) only build a retryable
// APIError when the error object carries a string message, NO `type` field, and a
// numeric 4xx/5xx (or known retryable) `code` — a string `type` makes their
// envelope synthesis bail out entirely. So the emitted envelope is always
// `{ message, code }` with transient failures pinned to 502; keep the original
// fields and replace any JSON-blob message with plain text.
export function normalizeResponsesErrorEvent(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;

  const source = payload.error && typeof payload.error === "object" ? payload.error : payload;
  // Only payloads that actually carry a message are error-shaped; leave normal
  // Responses events (deltas, completed, …) untouched.
  const message = normalizeErrorMessage(source.message ?? source.error ?? payload.message);
  if (!message) return payload;

  // A double-encoded message hides the upstream code inside the same blob.
  let nested = null;
  const rawMessage = typeof source.message === "string"
    ? source.message
    : (typeof payload.message === "string" ? payload.message : "");
  if (rawMessage.trim().startsWith("{")) {
    try { nested = JSON.parse(rawMessage); } catch { nested = null; }
  }

  const upstreamCode = [source.code, payload.code, nested?.code]
    .find((value) => (typeof value === "string" && value) || typeof value === "number");
  const code = upstreamCode == null || isTransientStreamError(message) ? 502 : upstreamCode;

  return {
    ...payload,
    // Clients read the top-level message too — never hand them the raw blob.
    message,
    error: { message, code },
  };
}

// Synthesize a response.failed event for streams that close without a terminal event
export function formatIncompleteOpenAIResponsesStreamFailure() {
  return formatSSE({
    event: "response.failed",
    data: {
      type: "response.failed",
      response: {
        id: `resp_${Date.now()}`,
        status: "failed",
        error: {
          type: "stream_error",
          code: "stream_disconnected",
          message: "stream closed before response.completed"
        }
      }
    }
  }, FORMATS.OPENAI_RESPONSES);
}
