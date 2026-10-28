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
export function buildAbortedResponsesTerminalBytes() {
  return sharedEncoder.encode(`${formatIncompleteOpenAIResponsesStreamFailure()}data: [DONE]\n\n`);
}

/**
 * A streaming Responses client (e.g. Codex) only runs its context-overflow
 * recovery when the failure arrives as a `response.failed` event; an HTTP 400
 * body is read as a generic invalid request. Re-frame that one error class as
 * the event the client understands. Every other response is returned untouched,
 * and non-streaming callers keep the HTTP 400.
 */
export async function contextOverflowAsResponsesFailure(response) {
  if (!response || (response.status !== 400 && response.status !== 413)) return response;
  if (!(response.headers.get("content-type") || "").includes("application/json")) return response;
  let error;
  try {
    error = (await response.clone().json())?.error;
  } catch {
    return response;
  }
  if (error?.code !== "context_length_exceeded") return response;
  const event = formatSSE({
    event: "response.failed",
    data: {
      type: "response.failed",
      response: {
        id: `resp_${Date.now()}`,
        object: "response",
        status: "failed",
        error: { type: "invalid_request_error", code: error.code, message: error.message || "" }
      }
    }
  }, FORMATS.OPENAI_RESPONSES);
  response.body?.cancel?.().catch(() => {});
  return new Response(sharedEncoder.encode(`${event}data: [DONE]\n\n`), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" }
  });
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
