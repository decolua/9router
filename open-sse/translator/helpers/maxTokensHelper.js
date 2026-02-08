import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../config/constants.js";

/**
 * Adjust max_tokens based on request context
 * @param {object} body - Request body
 * @returns {number} Adjusted max_tokens
 */
export function adjustMaxTokens(body) {
  let maxTokens = body.max_tokens || DEFAULT_MAX_TOKENS;
  
  // Auto-increase for tool calling to prevent truncated arguments
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    if (maxTokens < DEFAULT_MIN_TOKENS) {
      maxTokens = DEFAULT_MIN_TOKENS;
    }
  }
  
  // Ensure max_tokens > thinking.budget_tokens (Claude API requirement)
  if (body.thinking?.budget_tokens && maxTokens <= body.thinking.budget_tokens) {
    maxTokens = DEFAULT_MAX_TOKENS;
  }
  
  return maxTokens;
}

