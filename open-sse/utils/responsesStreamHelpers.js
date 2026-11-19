// Helpers for OpenAI Responses API streaming termination + event framing
import { FORMATS } from "../translator/formats.js";
import { detectSseEventError, formatSSE } from "./streamHelpers.js";
import { getClientErrorStatus, getStreamErrorStatus, isTransientStreamError } from "./error.js";
import { RESPONSES_EVENT } from "../translator/schema/streamEvents.js";
import { RESPONSES_STATUS } from "../translator/schema/finishReasons.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { STREAM_FAILURE_MESSAGES } from "../config/errorConfig.js";
import { SSE_DONE } from "./sseConstants.js";

// Responses API events that signal the stream has reached a terminal state
const OPENAI_RESPONSES_TERMINAL_EVENTS = new Set([
  RESPONSES_EVENT.COMPLETED,
  RESPONSES_EVENT.DONE,
  RESPONSES_EVENT.INCOMPLETE,
  RESPONSES_EVENT.FAILED,
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
  return status === RESPONSES_STATUS.COMPLETED || status === RESPONSES_STATUS.INCOMPLETE || status === RESPONSES_STATUS.FAILED;
}

const sharedEncoder = new TextEncoder();

// Encoded response.failed + [DONE] payload for aborted/stalled Responses passthrough streams
export function buildAbortedResponsesTerminalBytes(message, status, responseId) {
  return sharedEncoder.encode(formatIncompleteOpenAIResponsesStreamFailure(message, status, responseId) + SSE_DONE);
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
  const detected = detectSseEventError(payload);
  if (!detected) return payload;
  const { message } = detected;
  const status = getStreamErrorStatus(detected);
  const code = isTransientStreamError(detected.code) || isTransientStreamError(message)
    ? HTTP_STATUS.BAD_GATEWAY
    : status != null ? getClientErrorStatus(status, message) : detected.code ?? HTTP_STATUS.BAD_GATEWAY;
  const error = { message, code };
  return {
    ...payload,
    message,
    error,
    ...(payload?.response?.error ? { response: { ...payload.response, error } } : {}),
  };
}

// Synthesize a response.failed event for streams that close without a terminal event
export function formatIncompleteOpenAIResponsesStreamFailure(message = STREAM_FAILURE_MESSAGES.missingTerminal, code = HTTP_STATUS.GATEWAY_TIMEOUT, responseId) {
  const error = { message, code };
  return formatSSE({
    event: RESPONSES_EVENT.FAILED,
    data: {
      type: RESPONSES_EVENT.FAILED,
      error,
      response: {
        id: responseId || `resp_${Date.now()}`,
        status: RESPONSES_STATUS.FAILED,
        error,
      }
    }
  }, FORMATS.OPENAI_RESPONSES);
}
