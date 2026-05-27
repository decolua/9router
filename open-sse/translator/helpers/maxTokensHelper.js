import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig.js";

/**
 * Get the effective default max_tokens based on context window setting.
 * When 1M context window is enabled (via CONTEXT_WINDOW env or setting), return higher limit.
 */
export function getDefaultMaxTokens() {
  const envCw = parseInt(process.env.CONTEXT_WINDOW, 10);
  if (envCw >= 1048576) return 128000;
  return DEFAULT_MAX_TOKENS;
}

export function adjustMaxTokens(body) {
  const effectiveDefault = getDefaultMaxTokens();
  let maxTokens = body.max_tokens || effectiveDefault;

  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    if (maxTokens < DEFAULT_MIN_TOKENS) maxTokens = DEFAULT_MIN_TOKENS;
  }

  if (body.thinking?.budget_tokens && maxTokens <= body.thinking.budget_tokens) {
    maxTokens = body.thinking.budget_tokens + 1024;
  }

  return maxTokens;
}

