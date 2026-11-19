// Streaming event "type" discriminators — fixed per client format. Pure data (no logic).

// Anthropic Messages SSE events (client format of /v1/messages).
export const CLAUDE_EVENT = {
  MESSAGE_START: "message_start",
  CONTENT_BLOCK_START: "content_block_start",
  CONTENT_BLOCK_DELTA: "content_block_delta",
  CONTENT_BLOCK_STOP: "content_block_stop",
  MESSAGE_DELTA: "message_delta",
  MESSAGE_STOP: "message_stop",
  PING: "ping",
};

// Anthropic content_block_delta delta types.
export const CLAUDE_DELTA = {
  TEXT: "text_delta",
  INPUT_JSON: "input_json_delta",
};

// OpenAI Responses API SSE events (client format of /v1/responses).
// Every one of these starts with RESPONSES_EVENT_PREFIX.
export const RESPONSES_EVENT_PREFIX = "response.";
export const RESPONSES_EVENT = {
  CREATED: "response.created",
  IN_PROGRESS: "response.in_progress",
  QUEUED: "response.queued",
  OUTPUT_ITEM_ADDED: "response.output_item.added",
  OUTPUT_ITEM_DONE: "response.output_item.done",
  CONTENT_PART_ADDED: "response.content_part.added",
  REASONING_SUMMARY_PART_ADDED: "response.reasoning_summary_part.added",
  OUTPUT_TEXT_DELTA: "response.output_text.delta",
  OUTPUT_TEXT_DONE: "response.output_text.done",
  FUNCTION_CALL_ARGUMENTS_DELTA: "response.function_call_arguments.delta",
  CUSTOM_TOOL_CALL_INPUT_DELTA: "response.custom_tool_call_input.delta",
  COMPLETED: "response.completed",
  DONE: "response.done",
  INCOMPLETE: "response.incomplete",
  FAILED: "response.failed",
};
