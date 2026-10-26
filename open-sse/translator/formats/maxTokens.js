import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig.js";

/**
 * Adjust max_tokens based on request context
 * @param {object} body - Request body
 * @param {number} [ceiling=DEFAULT_MAX_TOKENS] - Upper bound for max_tokens.
 *   Callers with model context (e.g. openai-to-claude) pass the model's real
 *   maxOutput so high-output models (Opus 4.8 = 128000) aren't pre-clamped to
 *   the conservative 64000 default before the model-aware step sees them.
 * @returns {{maxTokens: number, wasExplicit: boolean}} Adjusted max_tokens and whether client explicitly provided it
 */
export function adjustMaxTokens(body, ceiling = DEFAULT_MAX_TOKENS) {
  const wasExplicit = body.max_tokens !== undefined;
  let maxTokens = wasExplicit ? body.max_tokens : DEFAULT_MAX_TOKENS;

  // Auto-increase for tool calling to prevent truncated arguments (min never above max)
  // Only auto-increase if client didn't explicitly set a value
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    if (!wasExplicit) {
      maxTokens = Math.max(maxTokens, DEFAULT_MIN_TOKENS);
    }
  }

  // Ensure max_tokens > thinking.budget_tokens (Claude API requirement)
  // Claude API requires strictly greater, so add buffer instead of using the
  // ceiling which could equal budget_tokens when budget_tokens >= ceiling
  if (body.thinking?.budget_tokens && maxTokens <= body.thinking.budget_tokens) {
    maxTokens = body.thinking.budget_tokens + 1024;
  }

  // Never exceed the ceiling (only clamp if we know the ceiling is real/known)
  // If ceiling is the conservative DEFAULT_MAX_TOKENS and model is unknown, don't silently clamp
  // Only clamp if ceiling is a real model limit (not DEFAULT_MAX_TOKENS)
  const isKnownCeiling = ceiling !== DEFAULT_MAX_TOKENS;
  if (maxTokens > ceiling && isKnownCeiling) {
    maxTokens = ceiling;
  }

  return { maxTokens, wasExplicit };
}

