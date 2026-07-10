export const CODEX_RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";
export const CODEX_RESPONSES_LITE_HEADER_VALUE = "true";
export const CODEX_FORWARD_HEADER_ALLOWLIST = Object.freeze([CODEX_RESPONSES_LITE_HEADER]);
export const CODEX_RESPONSES_LITE_INPUT_TYPES = Object.freeze([
  "additional_tools", "function_call", "function_call_output", "custom_tool_call",
  "custom_tool_call_output", "tool_search_call", "tool_search_output", "reasoning", "message",
]);
