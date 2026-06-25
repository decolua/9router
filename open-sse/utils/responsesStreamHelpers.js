// Helpers for OpenAI Responses API streaming termination + event framing
import { FORMATS } from "../translator/formats.js";
import { formatSSE } from "./streamHelpers.js";

// Responses API events that signal the stream has reached a terminal state
const OPENAI_RESPONSES_TERMINAL_EVENTS = new Set([
  "response.completed",
  "response.failed",
  "error"
]);

const RETRYABLE_FAILURE_RULES = [
  {
    status: 503,
    patterns: [
      "model_at_capacity",
      "server_is_overloaded",
      "service_unavailable_error",
      "temporarily unavailable",
      "server busy",
      "backend overloaded",
      "overloaded",
      "capacity",
    ],
  },
  {
    status: 429,
    patterns: [
      "rate_limit_exceeded",
      "too many requests",
      "too_many_requests",
      "usage_limit_reached",
      "quota_exceeded",
      "insufficient_quota",
      "rate limit",
      "quota exceeded",
    ],
  },
];

const OPENAI_RESPONSES_OUTPUT_EVENTS = new Set([
  "response.output_text.delta",
  "response.refusal.delta",
  "response.function_call_arguments.delta",
  "response.reasoning_summary_text.delta",
  "response.output_item.done",
  "response.content_part.done",
]);

function toLowerText(value) {
  if (typeof value === "string") return value.toLowerCase();
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value).toLowerCase();
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

function parseSSEFrame(frame) {
  if (typeof frame !== "string") return null;
  const lines = frame.split(/\r?\n/);
  let eventName = null;
  const dataLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^\s?/, ""));
    }
  }

  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join("\n").trim();
  if (!dataStr || dataStr === "[DONE]") {
    return { eventName, done: dataStr === "[DONE]" };
  }

  try {
    return { eventName, data: JSON.parse(dataStr) };
  } catch {
    return { eventName, rawData: dataStr };
  }
}

function classifyRetryableFailureFromText(text) {
  const lower = toLowerText(text);
  if (!lower) return null;

  for (const rule of RETRYABLE_FAILURE_RULES) {
    for (const pattern of rule.patterns) {
      if (lower.includes(pattern)) {
        return { matched: pattern, status: rule.status };
      }
    }
  }

  return null;
}

function extractResponsesFailurePayload(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  return parsed.error || parsed.response?.error || parsed.response || parsed;
}

function classifyRetryableResponsesFailure(parsedFrame) {
  if (!parsedFrame || typeof parsedFrame !== "object") return null;

  const eventName = parsedFrame.eventName || parsedFrame.data?.type || parsedFrame.data?.response?.type || null;
  const data = parsedFrame.data ?? parsedFrame.rawData ?? null;
  if (!data) return null;

  const isTerminalFailure =
    eventName === "error" ||
    eventName === "response.failed" ||
    data?.type === "error" ||
    data?.type === "response.failed" ||
    data?.response?.status === "failed" ||
    data?.status === "failed";

  if (!isTerminalFailure) return null;

  const payload = extractResponsesFailurePayload(data);
  const candidates = [
    payload?.code,
    payload?.type,
    payload?.message,
    payload?.reason,
    payload,
    data?.response?.status,
    data?.status,
    data,
  ];

  for (const candidate of candidates) {
    const match = classifyRetryableFailureFromText(candidate);
    if (match) {
      return {
        matched: match.matched,
        status: match.status,
        message: typeof payload?.message === "string"
          ? payload.message
          : (typeof data?.response?.error?.message === "string"
            ? data.response.error.message
            : (typeof data?.message === "string" ? data.message : null)),
      };
    }
  }

  return null;
}

function classifyOpenAIResponsesFailure(parsedFrame) {
  if (!parsedFrame || typeof parsedFrame !== "object") return null;

  const eventName = parsedFrame.eventName || parsedFrame.data?.type || parsedFrame.data?.response?.type || null;
  const data = parsedFrame.data ?? parsedFrame.rawData ?? null;
  if (!data) return null;

  const isTerminalFailure =
    eventName === "error" ||
    eventName === "response.failed" ||
    data?.type === "error" ||
    data?.type === "response.failed" ||
    data?.response?.status === "failed" ||
    data?.status === "failed";

  if (!isTerminalFailure) return null;

  const payload = extractResponsesFailurePayload(data);
  const retryable = classifyRetryableResponsesFailure(parsedFrame);
  return {
    status: retryable?.status || 502,
    matched: retryable?.matched || null,
    code: typeof payload?.code === "string" ? payload.code : null,
    type: typeof payload?.type === "string" ? payload.type : null,
    message: typeof payload?.message === "string"
      ? payload.message
      : (typeof data?.response?.error?.message === "string"
        ? data.response.error.message
        : (typeof data?.message === "string" ? data.message : null)),
  };
}

/**
 * Detect retryable semantic failures in OpenAI Responses SSE text.
 * Returns null for successful streams or non-retryable terminal failures.
 */
export function detectRetryableResponsesStreamFailure(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  for (const frame of text.split(/\n\n+/)) {
    const parsedFrame = parseSSEFrame(frame);
    if (!parsedFrame) continue;
    const classified = classifyRetryableResponsesFailure(parsedFrame);
    if (classified) return classified;
  }

  return null;
}

/**
 * Detect any terminal OpenAI Responses failure in SSE text.
 * Unlike detectRetryableResponsesStreamFailure(), this is used after streaming
 * has started, where fallback is no longer safe but accounting still must
 * record the stream as failed.
 */
export function detectOpenAIResponsesStreamFailure(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  for (const frame of text.split(/\n\n+/)) {
    const parsedFrame = parseSSEFrame(frame);
    if (!parsedFrame) continue;
    const classified = classifyOpenAIResponsesFailure(parsedFrame);
    if (classified) return classified;
  }

  return null;
}

function hasValuableResponsesOutput(parsedFrame) {
  if (!parsedFrame || typeof parsedFrame !== "object") return false;
  const data = parsedFrame.data ?? null;
  const eventName = parsedFrame.eventName || data?.type || data?.response?.type || null;
  if (!eventName || !data) return false;

  if (eventName === "response.output_text.delta" || eventName === "response.refusal.delta") {
    return typeof data.delta === "string" && data.delta.length > 0;
  }

  if (eventName === "response.function_call_arguments.delta") {
    return typeof data.delta === "string" && data.delta.length > 0;
  }

  if (eventName === "response.reasoning_summary_text.delta") {
    return typeof data.delta === "string" && data.delta.length > 0;
  }

  if (eventName === "response.output_item.done") {
    const item = data.item;
    if (!item || typeof item !== "object") return false;
    if (item.type === "function_call") return true;
    if (item.type === "message" && Array.isArray(item.content)) return item.content.length > 0;
  }

  if (eventName === "response.content_part.done") {
    return !!data.part;
  }

  return OPENAI_RESPONSES_OUTPUT_EVENTS.has(eventName);
}

/**
 * Detect whether a Responses SSE prefix already reached client-visible output.
 * Callers can safely fallback only before this returns true.
 */
export function hasOpenAIResponsesStreamOutput(text) {
  if (typeof text !== "string" || !text.trim()) return false;

  for (const frame of text.split(/\n\n+/)) {
    const parsedFrame = parseSSEFrame(frame);
    if (!parsedFrame) continue;
    if (hasValuableResponsesOutput(parsedFrame)) return true;
  }

  return false;
}

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
