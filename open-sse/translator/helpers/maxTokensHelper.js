import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig.js";

/**
 * Get the effective default max_tokens based on context window setting.
 * When 1M context window is enabled (via CONTEXT_WINDOW env), return a higher token limit.
 * @returns {number} Effective default max_tokens
 */
export function getDefaultMaxTokens() {
  const envCw = parseInt(process.env.CONTEXT_WINDOW, 10);
  if (envCw >= 1048576) return 128000;
  return DEFAULT_MAX_TOKENS;
}

/**
 * Adjust max_tokens based on request context
 * @param {object} body - Request body
 * @returns {number} Adjusted max_tokens
 */
export function adjustMaxTokens(body) {
  const effectiveDefault = getDefaultMaxTokens();
  let maxTokens = body.max_tokens || effectiveDefault;

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

