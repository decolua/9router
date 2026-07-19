// Helpers for OpenAI Responses API streaming termination + event framing
import { FORMATS } from "../translator/formats.js";
import {
  createResponsesAccumulator,
  finalizeResponsesAccumulator
} from "../translator/concerns/responsesAccumulator.js";
import { formatSSE } from "./streamHelpers.js";

// Responses API events that signal the stream has reached a terminal state
const OPENAI_RESPONSES_TERMINAL_EVENTS = new Set([
  "response.completed",
  "response.done",
  "response.incomplete",
  "response.failed",
  "response.error",
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
export function buildAbortedResponsesTerminalBytes(accumulator = null) {
  const terminal = formatIncompleteOpenAIResponsesStreamFailure(accumulator);
  if (terminal) {
    if (accumulator) accumulator.doneSent = true;
    return sharedEncoder.encode(`${terminal}data: [DONE]\n\n`);
  }
  if (accumulator?.finalized && !accumulator.doneSent) {
    accumulator.doneSent = true;
    return sharedEncoder.encode("data: [DONE]\n\n");
  }
  return null;
}

// Synthesize a response.failed event for streams that close without a terminal event
export function formatIncompleteOpenAIResponsesStreamFailure(accumulator = null) {
  const state = accumulator || createResponsesAccumulator();
  const terminal = finalizeResponsesAccumulator(state, {
    error: {
      type: "stream_error",
      code: "stream_disconnected",
      message: "stream closed before response.completed"
    }
  });
  if (!terminal.accepted) return "";
  return formatSSE({
    event: "response.failed",
    data: {
      type: "response.failed",
      response: terminal.response
    }
  }, FORMATS.OPENAI_RESPONSES);
}
