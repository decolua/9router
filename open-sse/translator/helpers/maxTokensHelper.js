import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig.js";

export function getTokenLimit(body, fallback = undefined) {
  if (Number.isFinite(body.max_completion_tokens) && body.max_completion_tokens > 0) {
    return body.max_completion_tokens;
  }
  if (Number.isFinite(body.max_tokens) && body.max_tokens > 0) {
    return body.max_tokens;
  }
  return fallback;
}

/**
 * Adjust max_tokens based on request context.
 * OpenAI-style token limit precedence is max_completion_tokens, then max_tokens.
 * @param {object} body - Request body
 * @returns {number} Adjusted max_tokens
 */
export function adjustMaxTokens(body) {
  let maxTokens = getTokenLimit(body, DEFAULT_MAX_TOKENS);

  // Auto-increase for tool calling to prevent truncated arguments
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    if (maxTokens < DEFAULT_MIN_TOKENS) {
      maxTokens = DEFAULT_MIN_TOKENS;
    }
  }

  // Ensure max_tokens > thinking.budget_tokens (Claude API requirement)
  // Claude API requires strictly greater, so add buffer instead of using DEFAULT_MAX_TOKENS
  // which could equal budget_tokens when budget_tokens >= 64000
  if (body.thinking?.budget_tokens && maxTokens <= body.thinking.budget_tokens) {
    maxTokens = body.thinking.budget_tokens + 1024;
  }

  return maxTokens;
}

