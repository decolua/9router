/**
 * CodeBuddy CN chat wire constants.
 *
 * The gateway is OpenAI-shaped, but the CN transport intentionally forwards
 * only fields verified for its chat contract. Unsupported passthrough fields
 * remain stripped at the protocol boundary.
 */

/** Top-level fields forwarded when present. */
export const CHAT_BODY_ALLOWLIST = Object.freeze([
  "model",
  "messages",
  "stream",
  "temperature",
  "top_p",
  "top_k",
  "n",
  "stop",
  "max_tokens",
  "max_completion_tokens",
  "presence_penalty",
  "frequency_penalty",
  "logit_bias",
  "user",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "response_format",
  "seed",
  // Conditional — kept only when effort is on (see request.js).
  "reasoning_effort",
  "reasoning_summary",
]);

/** Effort values that mean "do not send reasoning params". */
export const REASONING_OFF = Object.freeze(new Set(["none", "off", ""]));
