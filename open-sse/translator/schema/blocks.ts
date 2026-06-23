// Content-block "type" discriminators — fixed per format. Pure data (no logic).

// OpenAI chat content blocks + tool_call wrapper.
export const OPENAI_BLOCK = {
  TEXT: "text",
  IMAGE_URL: "image_url",
  IMAGE: "image",
  INPUT_AUDIO: "input_audio",
  AUDIO_URL: "audio_url",
  FILE: "file",
  FUNCTION: "function",
} as const;

// Claude content blocks.
export const CLAUDE_BLOCK = {
  TEXT: "text",
  IMAGE: "image",
  DOCUMENT: "document",
  TOOL_USE: "tool_use",
  TOOL_RESULT: "tool_result",
  THINKING: "thinking",
  REDACTED_THINKING: "redacted_thinking",
} as const;

// OpenAI Responses API item types.
export const RESPONSES_ITEM = {
  MESSAGE: "message",
  FUNCTION_CALL: "function_call",
  FUNCTION_CALL_OUTPUT: "function_call_output",
  REASONING: "reasoning",
  OUTPUT_TEXT: "output_text",
  INPUT_TEXT: "input_text",
  INPUT_IMAGE: "input_image",
  SUMMARY_TEXT: "summary_text",
} as const;

// Valid OpenAI block types (used by filterToOpenAIFormat).
export const VALID_OPENAI_CONTENT_TYPES = [
  OPENAI_BLOCK.TEXT, OPENAI_BLOCK.IMAGE_URL, OPENAI_BLOCK.IMAGE, OPENAI_BLOCK.INPUT_AUDIO, OPENAI_BLOCK.AUDIO_URL, OPENAI_BLOCK.FILE,
] as const;
export const VALID_OPENAI_MESSAGE_TYPES = [
  OPENAI_BLOCK.TEXT, OPENAI_BLOCK.IMAGE_URL, OPENAI_BLOCK.IMAGE, "tool_calls", CLAUDE_BLOCK.TOOL_RESULT,
] as const;

// ---------------------------------------------------------------------------
// Compile-time key-completeness guards
// ---------------------------------------------------------------------------
type KeysEqual<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never]
  ? true
  : false;
type AssertTrue<T extends true> = T;

type _OpenAIBlockKeysMatch = AssertTrue<
  KeysEqual<
    keyof typeof OPENAI_BLOCK,
    "TEXT" | "IMAGE_URL" | "IMAGE" | "INPUT_AUDIO" | "AUDIO_URL" | "FILE" | "FUNCTION"
  >
>;
type _ClaudeBlockKeysMatch = AssertTrue<
  KeysEqual<
    keyof typeof CLAUDE_BLOCK,
    "TEXT" | "IMAGE" | "DOCUMENT" | "TOOL_USE" | "TOOL_RESULT" | "THINKING" | "REDACTED_THINKING"
  >
>;
type _ResponsesItemKeysMatch = AssertTrue<
  KeysEqual<
    keyof typeof RESPONSES_ITEM,
    | "MESSAGE"
    | "FUNCTION_CALL"
    | "FUNCTION_CALL_OUTPUT"
    | "REASONING"
    | "OUTPUT_TEXT"
    | "INPUT_TEXT"
    | "INPUT_IMAGE"
    | "SUMMARY_TEXT"
  >
>;
