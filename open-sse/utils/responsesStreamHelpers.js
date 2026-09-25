// Helpers for OpenAI Responses API streaming termination + event framing
import { FORMATS } from "../translator/formats.js";
import { formatSSE } from "./streamHelpers.js";

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

// Responses events that report a client-visible failure rather than a finished
// turn. These arrive after HTTP 200 and after response.created, so the stream
// itself completes normally - which is why they used to leave no trace in
// requestDetails (issue #4104).
const OPENAI_RESPONSES_FAILURE_EVENTS = new Set(["error", "response.failed"]);

export function isOpenAIResponsesFailureEvent(eventName, chunk) {
  const type = getOpenAIResponsesEventName(eventName, chunk);
  if (OPENAI_RESPONSES_FAILURE_EVENTS.has(type)) return true;
  return chunk?.response?.status === "failed";
}

// Pull a displayable error out of an `error` or `response.failed` event so the
// requestDetails row records what actually went wrong.
export function extractOpenAIResponsesFailure(chunk) {
  const fallback = { type: "stream_error", code: "stream_failed", message: "upstream reported a failed Responses stream" };
  const error = chunk?.error || chunk?.response?.error;
  if (!error) return fallback;
  if (typeof error === "string") return { ...fallback, message: error };
  return {
    type: error.type || fallback.type,
    code: error.code || fallback.code,
    message: error.message || fallback.message,
  };
}

const sharedEncoder = new TextEncoder();

// Encoded response.failed + [DONE] payload for aborted/stalled Responses passthrough streams
export function buildAbortedResponsesTerminalBytes() {
  return sharedEncoder.encode(`${formatIncompleteOpenAIResponsesStreamFailure()}data: [DONE]\n\n`);
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
