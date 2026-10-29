// Streaming event "type" discriminators — fixed per client format. Pure data (no logic).

// Anthropic Messages SSE events (client format of /v1/messages).
export const CLAUDE_EVENT = {
  CONTENT_BLOCK_START: "content_block_start",
  CONTENT_BLOCK_DELTA: "content_block_delta",
  MESSAGE_DELTA: "message_delta",
};

// Anthropic content_block_delta delta types.
export const CLAUDE_DELTA = {
  TEXT: "text_delta",
  THINKING: "thinking_delta",
  INPUT_JSON: "input_json_delta",
};

// OpenAI Responses API SSE events (client format of /v1/responses).
// Every one of these starts with RESPONSES_EVENT_PREFIX.
export const RESPONSES_EVENT_PREFIX = "response.";
export const RESPONSES_EVENT = {
  OUTPUT_ITEM_ADDED: "response.output_item.added",
  OUTPUT_ITEM_DONE: "response.output_item.done",
  OUTPUT_TEXT_DELTA: "response.output_text.delta",
  OUTPUT_TEXT_DONE: "response.output_text.done",
  REASONING_SUMMARY_TEXT_DELTA: "response.reasoning_summary_text.delta",
  REASONING_SUMMARY_TEXT_DONE: "response.reasoning_summary_text.done",
  REASONING_TEXT_DELTA: "response.reasoning_text.delta",
  FUNCTION_CALL_ARGUMENTS_DELTA: "response.function_call_arguments.delta",
  CUSTOM_TOOL_CALL_INPUT_DELTA: "response.custom_tool_call_input.delta",
  COMPLETED: "response.completed",
  INCOMPLETE: "response.incomplete",
  FAILED: "response.failed",
};
