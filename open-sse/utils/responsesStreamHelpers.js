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

const sharedEncoder = new TextEncoder();

// Encoded response.failed + [DONE] payload for aborted/stalled Responses passthrough streams
export function buildAbortedResponsesTerminalBytes({ model } = {}) {
  return buildResponsesFailureTerminalBytes(
    "stream closed before response.completed",
    { code: "stream_disconnected", model },
  );
}

export function buildResponsesFailureTerminalBytes(message, options = {}) {
  return sharedEncoder.encode(`${formatOpenAIResponsesStreamFailure(message, options)}data: [DONE]\n\n`);
}

// Synthesize a response.failed event for streams that close without a terminal event
export function formatIncompleteOpenAIResponsesStreamFailure({ model } = {}) {
  return formatOpenAIResponsesStreamFailure(
    "stream closed before response.completed",
    { code: "stream_disconnected", model },
  );
}

function formatOpenAIResponsesStreamFailure(message, {
  code = "upstream_error",
  model = "unknown",
  sequenceNumber = 1,
} = {}) {
  const now = Date.now();
  return formatSSE({
    event: "response.failed",
    data: {
      type: "response.failed",
      sequence_number: sequenceNumber,
      response: {
        id: `resp_${now}_${Math.random().toString(36).slice(2, 8)}`,
        object: "response",
        created_at: Math.floor(now / 1000),
        status: "failed",
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: model || "unknown",
        output: [],
        parallel_tool_calls: true,
        temperature: null,
        tool_choice: "auto",
        tools: [],
        top_p: null,
        error: {
          code,
          message,
        }
      }
    }
  }, FORMATS.OPENAI_RESPONSES);
}
