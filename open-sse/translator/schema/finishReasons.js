// Finish/stop reason enums. Pure data — mapping LOGIC lives in concerns/finishReason.js.

// OpenAI finish_reason values (the hub format; shared across all response translators).
export const OPENAI_FINISH = {
  STOP: "stop",
  LENGTH: "length",
  TOOL_CALLS: "tool_calls",
  CONTENT_FILTER: "content_filter",
  // Internal hub value: upstream aborted the turn (e.g. Gemini MALFORMED_FUNCTION_CALL).
  // Response translators surface it as an error instead of a clean stop.
  ERROR: "error",
};

// Claude stop_reason values.
export const CLAUDE_STOP = {
  END_TURN: "end_turn",
  MAX_TOKENS: "max_tokens",
  TOOL_USE: "tool_use",
  STOP_SEQUENCE: "stop_sequence",
};

// Gemini finishReason values.
export const GEMINI_FINISH = {
  STOP: "STOP",
  MAX_TOKENS: "MAX_TOKENS",
  SAFETY: "SAFETY",
  RECITATION: "RECITATION",
  BLOCKLIST: "BLOCKLIST",
  PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
  SPII: "SPII",
  IMAGE_SAFETY: "IMAGE_SAFETY",
  MALFORMED_FUNCTION_CALL: "MALFORMED_FUNCTION_CALL",
  UNEXPECTED_TOOL_CALL: "UNEXPECTED_TOOL_CALL",
  FINISH_REASON_UNSPECIFIED: "FINISH_REASON_UNSPECIFIED",
  OTHER: "OTHER",
  LANGUAGE: "LANGUAGE",
  NO_IMAGE: "NO_IMAGE",
};

// Gemini finishReasons that mean the turn was aborted upstream, not completed.
// Forwarding them as a clean stop makes the client treat a broken turn (e.g. an
// aborted tool call) as a finished answer — the "model says it will act but does
// nothing" failure. Shared with the antigravity empty-stream guard.
export const GEMINI_ERROR_FINISH_REASONS = new Set([
  GEMINI_FINISH.MALFORMED_FUNCTION_CALL,
  GEMINI_FINISH.UNEXPECTED_TOOL_CALL,
  GEMINI_FINISH.FINISH_REASON_UNSPECIFIED,
  GEMINI_FINISH.OTHER,
  GEMINI_FINISH.LANGUAGE,
  GEMINI_FINISH.NO_IMAGE,
]);
