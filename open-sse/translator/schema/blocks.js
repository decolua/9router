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
};

// Claude content blocks.
export const CLAUDE_BLOCK = {
  TEXT: "text",
  IMAGE: "image",
  DOCUMENT: "document",
  TOOL_USE: "tool_use",
  TOOL_RESULT: "tool_result",
  THINKING: "thinking",
  REDACTED_THINKING: "redacted_thinking",
  SERVER_TOOL_USE: "server_tool_use",
  WEB_SEARCH_TOOL_RESULT: "web_search_tool_result",
};

// OpenAI Responses API item types.
export const RESPONSES_ITEM = {
  MESSAGE: "message",
  FUNCTION_CALL: "function_call",
  FUNCTION_CALL_OUTPUT: "function_call_output",
  CUSTOM_TOOL_CALL: "custom_tool_call",
  CUSTOM_TOOL_CALL_OUTPUT: "custom_tool_call_output",
  ADDITIONAL_TOOLS: "additional_tools",
  REASONING: "reasoning",
  OUTPUT_TEXT: "output_text",
  INPUT_TEXT: "input_text",
  INPUT_IMAGE: "input_image",
  SUMMARY_TEXT: "summary_text",
};

// Claude Messages streaming event names (the `type` field of each SSE frame).
export const CLAUDE_EVENT = {
  MESSAGE_START: "message_start",
  MESSAGE_DELTA: "message_delta",
  MESSAGE_STOP: "message_stop",
  CONTENT_BLOCK_START: "content_block_start",
  CONTENT_BLOCK_DELTA: "content_block_delta",
  CONTENT_BLOCK_STOP: "content_block_stop",
  PING: "ping",
  ERROR: "error",
};

// Claude `content_block_delta` discriminators (`delta.type`).
export const CLAUDE_DELTA = {
  TEXT: "text_delta",
  THINKING: "thinking_delta",
  INPUT_JSON: "input_json_delta",
  SIGNATURE: "signature_delta",
};

// OpenAI Responses API streaming event names.
export const RESPONSES_EVENT = {
  CREATED: "response.created",
  OUTPUT_ITEM_ADDED: "response.output_item.added",
  OUTPUT_TEXT_DELTA: "response.output_text.delta",
  REASONING_SUMMARY_TEXT_DELTA: "response.reasoning_summary_text.delta",
  FUNCTION_CALL_ARGS_DELTA: "response.function_call_arguments.delta",
  OUTPUT_ITEM_DONE: "response.output_item.done",
  COMPLETED: "response.completed",
  FAILED: "response.failed",
  DONE: "response.done",
};

// Valid OpenAI block types (used by filterToOpenAIFormat).

export const VALID_OPENAI_CONTENT_TYPES = [
  OPENAI_BLOCK.TEXT, OPENAI_BLOCK.IMAGE_URL, OPENAI_BLOCK.IMAGE, OPENAI_BLOCK.INPUT_AUDIO, OPENAI_BLOCK.AUDIO_URL, OPENAI_BLOCK.FILE,
];
export const VALID_OPENAI_MESSAGE_TYPES = [
  OPENAI_BLOCK.TEXT, OPENAI_BLOCK.IMAGE_URL, OPENAI_BLOCK.IMAGE, "tool_calls", CLAUDE_BLOCK.TOOL_RESULT,
];
