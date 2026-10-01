// Finish/stop reason enums. Pure data — mapping LOGIC lives in concerns/finishReason.js.

// OpenAI finish_reason values (the hub format; shared across all response translators).
export const OPENAI_FINISH = {
  STOP: "stop",
  LENGTH: "length",
  TOOL_CALLS: "tool_calls",
  CONTENT_FILTER: "content_filter",
};

// Claude stop_reason values.
export const CLAUDE_STOP = {
  END_TURN: "end_turn",
  MAX_TOKENS: "max_tokens",
  TOOL_USE: "tool_use",
  STOP_SEQUENCE: "stop_sequence",
  // Anthropic's API-level refusal (streaming classifier / ToS). Arrives in
  // message_delta with zero output tokens; stop_details carries the reason.
  REFUSAL: "refusal",
};

// Gemini finishReason values.
export const GEMINI_FINISH = {
  STOP: "STOP",
  MAX_TOKENS: "MAX_TOKENS",
  SAFETY: "SAFETY",
  RECITATION: "RECITATION",
  BLOCKLIST: "BLOCKLIST",
  PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
  // Abort reasons that Google returns with HTTP 200 and empty/partial content. These are
  // NOT mapped to a distinct client finish_reason (that would break OpenAI-format clients);
  // the empty-content failover keys on absence of content, not on these names. Listed so the
  // set below can classify them and so logs can name them.
  MALFORMED_FUNCTION_CALL: "MALFORMED_FUNCTION_CALL",
  UNEXPECTED_TOOL_CALL: "UNEXPECTED_TOOL_CALL",
  OTHER: "OTHER",
};

// Client-format (post-translation) finish_reasons whose empty output is LEGITIMATE and would
// recur on every candidate — so an empty stream ending in one of these must NOT be retried.
// The empty-content failover retries every other content-less finish by default (fail-open).
export const NO_RETRY_EMPTY_FINISH = new Set([OPENAI_FINISH.CONTENT_FILTER]);
