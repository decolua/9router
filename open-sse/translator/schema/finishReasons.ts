// Finish/stop reason enums. Pure data — mapping LOGIC lives in concerns/finishReason.js.

// OpenAI finish_reason values (the hub format; shared across all response translators).
export const OPENAI_FINISH = {
  STOP: "stop",
  LENGTH: "length",
  TOOL_CALLS: "tool_calls",
  CONTENT_FILTER: "content_filter",
} as const;

// Claude stop_reason values.
export const CLAUDE_STOP = {
  END_TURN: "end_turn",
  MAX_TOKENS: "max_tokens",
  TOOL_USE: "tool_use",
  STOP_SEQUENCE: "stop_sequence",
  REFUSAL: "refusal",
} as const;

// Gemini finishReason values.
export const GEMINI_FINISH = {
  STOP: "STOP",
  MAX_TOKENS: "MAX_TOKENS",
  SAFETY: "SAFETY",
  RECITATION: "RECITATION",
  BLOCKLIST: "BLOCKLIST",
  PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
} as const;

// ---------------------------------------------------------------------------
// Compile-time key-completeness guards
// ---------------------------------------------------------------------------
type KeysEqual<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never]
  ? true
  : false;
type AssertTrue<T extends true> = T;

type _OpenAIFinishKeysMatch = AssertTrue<
  KeysEqual<
    keyof typeof OPENAI_FINISH,
    "STOP" | "LENGTH" | "TOOL_CALLS" | "CONTENT_FILTER"
  >
>;
type _ClaudeStopKeysMatch = AssertTrue<
  KeysEqual<
    keyof typeof CLAUDE_STOP,
    "END_TURN" | "MAX_TOKENS" | "TOOL_USE" | "STOP_SEQUENCE" | "REFUSAL"
  >
>;
type _GeminiFinishKeysMatch = AssertTrue<
  KeysEqual<
    keyof typeof GEMINI_FINISH,
    "STOP" | "MAX_TOKENS" | "SAFETY" | "RECITATION" | "BLOCKLIST" | "PROHIBITED_CONTENT"
  >
>;
