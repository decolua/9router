import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig.js";

/**
 * Adjust max_tokens based on request context
 * @param {object} body - Request body
 * @param {number} [ceiling=DEFAULT_MAX_TOKENS] - Upper bound for max_tokens.
 *   Callers with model context (e.g. openai-to-claude) pass the model's real
 *   maxOutput so high-output models (Opus 4.8 = 128000) aren't pre-clamped to
 *   the conservative 64000 default before the model-aware step sees them.
 * @param {boolean} [honorExplicitCap=false] - Keep an explicit client cap
 *   (max_completion_tokens wins over max_tokens) instead of raising it to the
 *   tool floor, so a 1-token prompt-cache warm request stays 1 token.
 * @returns {number} Adjusted max_tokens
 */
export function adjustMaxTokens(body, ceiling = DEFAULT_MAX_TOKENS, honorExplicitCap = false) {
  let maxTokens = body.max_completion_tokens || body.max_tokens || DEFAULT_MAX_TOKENS;

  // Auto-increase for tool calling to prevent truncated arguments (min never above max)
  if (!honorExplicitCap && body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    if (maxTokens < DEFAULT_MIN_TOKENS) {
      maxTokens = DEFAULT_MIN_TOKENS;
    }
  }

  // Ensure max_tokens > thinking.budget_tokens (Claude API requirement)
  // Claude API requires strictly greater, so add buffer instead of using the
  // ceiling which could equal budget_tokens when budget_tokens >= ceiling
  if (body.thinking?.budget_tokens && maxTokens <= body.thinking.budget_tokens) {
    maxTokens = body.thinking.budget_tokens + 1024;
  }

  // Never exceed the ceiling
  if (maxTokens > ceiling) maxTokens = ceiling;

  return maxTokens;
}

