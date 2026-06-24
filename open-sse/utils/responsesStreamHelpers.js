// Helpers for OpenAI Responses API streaming termination + event framing
import { FORMATS } from "../translator/formats.js";
import { formatSSE } from "./streamHelpers.js";

// Responses API events that signal the stream has reached a terminal state
const OPENAI_RESPONSES_TERMINAL_EVENTS = new Set([
  "response.completed",
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

// Encoded response.failed + [DONE] payload for aborted/stalled Responses passthrough streams.
// Optional `reason` is folded into the error message for actionable diagnostics.
export function buildAbortedResponsesTerminalBytes(reason) {
  return sharedEncoder.encode(`${formatIncompleteOpenAIResponsesStreamFailure(reason)}data: [DONE]\n\n`);
}

// Synthesize a response.failed event for streams that close without a terminal event.
// Optional `reason` overrides the default message when a specific cause is known
// (e.g. "stream stalled", "upstream stream carried no content").
export function formatIncompleteOpenAIResponsesStreamFailure(reason) {
  const message = reason
    ? `stream closed before response.completed (${reason})`
    : "stream closed before response.completed";
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
          message,
        },
      },
    },
  }, FORMATS.OPENAI_RESPONSES);
}
