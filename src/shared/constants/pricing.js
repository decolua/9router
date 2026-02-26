// Default pricing rates for AI models
// All rates are in dollars per million tokens ($/1M tokens)
// Based on user-provided pricing for Antigravity models and industry standards for others

export const DEFAULT_PRICING = {
  // OAuth Providers (using aliases)

  // Claude Code (cc)
  cc: {
    "claude-opus-4-6": {
      input: 5.00,
      output: 25.00,
      cached: 0.50,
      reasoning: 25.00,
      cache_creation: 6.25
    },
    "claude-opus-4-5-20251101": {
      input: 5.00,
      output: 25.00,
      cached: 0.50,
      reasoning: 25.00,
      cache_creation: 6.25
    },
    "claude-sonnet-4-5-20250929": {
      input: 3.00,
      output: 15.00,
      cached: 0.30,
      reasoning: 15.00,
      cache_creation: 3.75
    },
    "claude-haiku-4-5-20251001": {
      input: 1.00,
      output: 5.00,
      cached: 0.10,
      reasoning: 5.00,
      cache_creation: 1.25
    }
  },

  // OpenAI Codex (cx)
  cx: {
    "gpt-5.3-codex": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "gpt-5.3-codex-xhigh": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "gpt-5.3-codex-high": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "gpt-5.3-codex-low": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "gpt-5.3-codex-none": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "gpt-5.3-codex-spark": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "gpt-5.2-codex": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "gpt-5.2": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "gpt-5.1-codex-max": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 1.25
    },
    "gpt-5.1-codex": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 1.25
    },
    "gpt-5.1-codex-mini": {
      input: 0.25,
      output: 2.00,
      cached: 0.03,
      reasoning: 2.00,
      cache_creation: 0.25
    },
    "gpt-5.1-codex-mini-high": {
      input: 0.25,
      output: 2.00,
      cached: 0.03,
      reasoning: 2.00,
      cache_creation: 0.25
    },
    "gpt-5.1": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 1.25
    },
    "gpt-5-codex": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 1.25
    },
    "gpt-5-codex-mini": {
      input: 0.25,
      output: 2.00,
      cached: 0.03,
      reasoning: 2.00,
      cache_creation: 0.25
    }
  },

  // Gemini CLI (gc)
  gc: {
    "gemini-3-flash-preview": {
      input: 0.50,
      output: 3.00,
      cached: 0.05,
      reasoning: 3.00,
      cache_creation: 0.08
    },
    "gemini-3-pro-preview": {
      input: 2.00,
      output: 12.00,
      cached: 0.20,
      reasoning: 12.00,
      cache_creation: 0.38
    },
    "gemini-2.5-pro": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 0.38
    },
    "gemini-2.5-flash": {
      input: 0.30,
      output: 2.50,
      cached: 0.03,
      reasoning: 2.50,
      cache_creation: 0.08
    },
    "gemini-2.5-flash-lite": {
      input: 0.10,
      output: 0.40,
      cached: 0.01,
      reasoning: 0.40,
      cache_creation: 0.08
    }
  },

  // Qwen Code (qw)
  qw: {
    "qwen3-coder-plus": {
      input: 1.00,
      output: 5.00,
      cached: 0.20,
      reasoning: 5.00,
      cache_creation: 1.00
    },
    "qwen3-coder-flash": {
      input: 0.30,
      output: 1.50,
      cached: 0.06,
      reasoning: 1.50,
      cache_creation: 0.30
    },
    "vision-model": {
      input: 0.05,
      output: 0.05,
      cached: 0.00,
      reasoning: 0.05,
      cache_creation: 0.05
    },
    "coder-model": {
      input: 0.22,
      output: 1.00,
      cached: 0.02,
      reasoning: 1.00,
      cache_creation: 0.22
    }
  },

  // iFlow AI (if)
  if: {
    "qwen3-coder-plus": {
      input: 1.00,
      output: 5.00,
      cached: 0.20,
      reasoning: 5.00,
      cache_creation: 1.00
    },
    "kimi-k2": {
      input: 0.55,
      output: 2.20,
      cached: 0.06,
      reasoning: 2.20,
      cache_creation: 0.55
    },
    "kimi-k2-thinking": {
      input: 0.47,
      output: 2.00,
      cached: 0.14,
      reasoning: 2.00,
      cache_creation: 0.47
    },
    "kimi-k2.5": {
      input: 0.45,
      output: 2.20,
      cached: 0.23,
      reasoning: 2.20,
      cache_creation: 0.45
    },
    "deepseek-r1": {
      input: 0.70,
      output: 2.50,
      cached: 0.07,
      reasoning: 2.50,
      cache_creation: 0.70
    },
    "deepseek-v3.2-chat": {
      input: 0.19,
      output: 0.87,
      cached: 0.10,
      reasoning: 0.87,
      cache_creation: 0.19
    },
    "deepseek-v3.2-reasoner": {
      input: 0.25,
      output: 0.40,
      cached: 0.03,
      reasoning: 0.40,
      cache_creation: 0.25
    },
    "minimax-m2.1": {
      input: 0.27,
      output: 0.95,
      cached: 0.03,
      reasoning: 0.95,
      cache_creation: 0.27
    },
    "minimax-m2.5": {
      input: 0.30,
      output: 1.10,
      cached: 0.15,
      reasoning: 1.10,
      cache_creation: 0.30
    },
    "glm-4.6": {
      input: 0.35,
      output: 1.71,
      cached: 0.04,
      reasoning: 1.71,
      cache_creation: 0.35
    },
    "glm-4.7": {
      input: 0.30,
      output: 1.40,
      cached: 0.15,
      reasoning: 1.40,
      cache_creation: 0.30
    },
    "glm-5": {
      input: 0.95,
      output: 2.55,
      cached: 0.20,
      reasoning: 2.55,
      cache_creation: 0.95
    }
  },

  // Antigravity (ag) - User-provided pricing
  ag: {
    "gemini-3.1-pro-low": {
      input: 2.00,
      output: 12.00,
      cached: 0.20,
      reasoning: 12.00,
      cache_creation: 0.38
    },
    "gemini-3.1-pro-high": {
      input: 2.00,
      output: 12.00,
      cached: 0.20,
      reasoning: 12.00,
      cache_creation: 0.38
    },
    "gemini-3.1-pro-high": {
      input: 2.00,
      output: 12.00,
      cached: 0.20,
      reasoning: 12.00,
      cache_creation: 0.38
    },
    "gemini-3-flash": {
      input: 0.50,
      output: 3.00,
      cached: 0.05,
      reasoning: 3.00,
      cache_creation: 0.08
    },
    "gemini-2.5-flash": {
      input: 0.30,
      output: 2.50,
      cached: 0.03,
      reasoning: 2.50,
      cache_creation: 0.08
    },
    "claude-sonnet-4-6": {
      input: 3.00,
      output: 15.00,
      cached: 0.30,
      reasoning: 15.00,
      cache_creation: 3.75
    },
    "claude-opus-4-5-thinking": {
      input: 5.00,
      output: 25.00,
      cached: 0.50,
      reasoning: 25.00,
      cache_creation: 6.25
    },
    "claude-opus-4-6-thinking": {
      input: 5.00,
      output: 25.00,
      cached: 0.50,
      reasoning: 25.00,
      cache_creation: 6.25
    },
    "gpt-oss-120b-medium": {
      input: 0.04,
      output: 0.19,
      cached: 0.00,
      reasoning: 0.19,
      cache_creation: 0.04
    }
  },

  // GitHub Copilot (gh)
  gh: {
    "gpt-3.5-turbo": {
      input: 0.50,
      output: 1.50,
      cached: 0.05,
      reasoning: 1.50,
      cache_creation: 0.50
    },
    "gpt-4": {
      input: 30.00,
      output: 60.00,
      cached: 3.00,
      reasoning: 60.00,
      cache_creation: 30.00
    },
    "gpt-4o": {
      input: 2.50,
      output: 10.00,
      cached: 1.25,
      reasoning: 10.00,
      cache_creation: 2.50
    },
    "gpt-4o-mini": {
      input: 0.15,
      output: 0.60,
      cached: 0.07,
      reasoning: 0.60,
      cache_creation: 0.15
    },
    "gpt-4.1": {
      input: 2.00,
      output: 8.00,
      cached: 0.50,
      reasoning: 8.00,
      cache_creation: 2.00
    },
    "gpt-5": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 1.25
    },
    "gpt-5-mini": {
      input: 0.25,
      output: 2.00,
      cached: 0.03,
      reasoning: 2.00,
      cache_creation: 0.25
    },
    "gpt-5-codex": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 1.25
    },
    "gpt-5.1": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 1.25
    },
    "gpt-5.1-codex": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 1.25
    },
    "gpt-5.1-codex-mini": {
      input: 0.25,
      output: 2.00,
      cached: 0.03,
      reasoning: 2.00,
      cache_creation: 0.25
    },
    "gpt-5.1-codex-max": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 1.25
    },
    "gpt-5.2": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "gpt-5.2-codex": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "gpt-5.3-codex": {
      input: 1.75,
      output: 14.00,
      cached: 0.17,
      reasoning: 14.00,
      cache_creation: 1.75
    },
    "claude-haiku-4.5": {
      input: 1.00,
      output: 5.00,
      cached: 0.10,
      reasoning: 5.00,
      cache_creation: 1.25
    },
    "claude-opus-4.1": {
      input: 15.00,
      output: 75.00,
      cached: 1.50,
      reasoning: 75.00,
      cache_creation: 18.75
    },
    "claude-opus-4.5": {
      input: 5.00,
      output: 25.00,
      cached: 0.50,
      reasoning: 25.00,
      cache_creation: 6.25
    },
    "claude-sonnet-4": {
      input: 3.00,
      output: 15.00,
      cached: 0.30,
      reasoning: 15.00,
      cache_creation: 3.75
    },
    "claude-sonnet-4.5": {
      input: 3.00,
      output: 15.00,
      cached: 0.30,
      reasoning: 15.00,
      cache_creation: 3.75
    },
    "claude-sonnet-4.6": {
      input: 3.00,
      output: 15.00,
      cached: 0.30,
      reasoning: 15.00,
      cache_creation: 3.75
    },
    "claude-opus-4.6": {
      input: 5.00,
      output: 25.00,
      cached: 0.50,
      reasoning: 25.00,
      cache_creation: 6.25
    },
    "gemini-2.5-pro": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 0.38
    },
    "gemini-3-flash-preview": {
      input: 0.50,
      output: 3.00,
      cached: 0.05,
      reasoning: 3.00,
      cache_creation: 0.08
    },
    "gemini-3-pro-preview": {
      input: 2.00,
      output: 12.00,
      cached: 0.20,
      reasoning: 12.00,
      cache_creation: 0.38
    },
    "grok-code-fast-1": {
      input: 0.20,
      output: 1.50,
      cached: 0.02,
      reasoning: 1.50,
      cache_creation: 0.20
    },
    "oswe-vscode-prime": {
      input: 0.20,
      output: 1.10,
      cached: 0.02,
      reasoning: 1.10,
      cache_creation: 0.20
    }
  },

  // Kiro AI (kr) - AWS CodeWhisperer
  kr: {
    "claude-sonnet-4.5": {
      input: 3.00,
      output: 15.00,
      cached: 0.30,
      reasoning: 15.00,
      cache_creation: 3.75
    },
    "claude-haiku-4.5": {
      input: 1.00,
      output: 5.00,
      cached: 0.10,
      reasoning: 5.00,
      cache_creation: 1.25
    }
  },

  // API Key Providers (alias = id)

  // OpenAI
  openai: {
    "gpt-4o": {
      input: 2.50,
      output: 10.00,
      cached: 1.25,
      reasoning: 10.00,
      cache_creation: 2.50
    },
    "gpt-4o-mini": {
      input: 0.15,
      output: 0.60,
      cached: 0.07,
      reasoning: 0.60,
      cache_creation: 0.15
    },
    "gpt-4-turbo": {
      input: 10.00,
      output: 30.00,
      cached: 1.00,
      reasoning: 30.00,
      cache_creation: 10.00
    },
    "o1": {
      input: 15.00,
      output: 60.00,
      cached: 7.50,
      reasoning: 60.00,
      cache_creation: 15.00
    },
    "o1-mini": {
      input: 15.00,
      output: 60.00,
      cached: 7.50,
      reasoning: 60.00,
      cache_creation: 15.00
    }
  },

  // Anthropic
  anthropic: {
    "claude-sonnet-4-20250514": {
      input: 3.00,
      output: 15.00,
      cached: 0.30,
      reasoning: 15.00,
      cache_creation: 3.75
    },
    "claude-opus-4-20250514": {
      input: 15.00,
      output: 75.00,
      cached: 1.50,
      reasoning: 75.00,
      cache_creation: 18.75
    },
    "claude-3-5-sonnet-20241022": {
      input: 6.00,
      output: 30.00,
      cached: 0.60,
      reasoning: 30.00,
      cache_creation: 7.50
    }
  },

  // Gemini
  gemini: {
    "gemini-3-pro-preview": {
      input: 2.00,
      output: 12.00,
      cached: 0.20,
      reasoning: 12.00,
      cache_creation: 0.38
    },
    "gemini-2.5-pro": {
      input: 1.25,
      output: 10.00,
      cached: 0.13,
      reasoning: 10.00,
      cache_creation: 0.38
    },
    "gemini-2.5-flash": {
      input: 0.30,
      output: 2.50,
      cached: 0.03,
      reasoning: 2.50,
      cache_creation: 0.08
    },
    "gemini-2.5-flash-lite": {
      input: 0.10,
      output: 0.40,
      cached: 0.01,
      reasoning: 0.40,
      cache_creation: 0.08
    }
  },

  // OpenRouter
  openrouter: {
    "auto": {
      input: 2.00,
      output: 8.00,
      cached: 1.00,
      reasoning: 12.00,
      cache_creation: 2.00
    }
  },

  // GLM
  glm: {
    "glm-4.7": {
      input: 0.30,
      output: 1.40,
      cached: 0.15,
      reasoning: 1.40,
      cache_creation: 0.30
    },
    "glm-4.6": {
      input: 0.35,
      output: 1.71,
      cached: 0.04,
      reasoning: 1.71,
      cache_creation: 0.35
    },
    "glm-4.6v": {
      input: 0.30,
      output: 0.90,
      cached: 0.03,
      reasoning: 0.90,
      cache_creation: 0.30
    },
    "glm-5": {
      input: 0.95,
      output: 2.55,
      cached: 0.20,
      reasoning: 2.55,
      cache_creation: 0.95
    }
  },

  // Kimi
  kimi: {
    "kimi-k2.5": {
      input: 0.45,
      output: 2.20,
      cached: 0.23,
      reasoning: 2.20,
      cache_creation: 0.45
    },
    "kimi-k2.5-thinking": {
      input: 0.45,
      output: 2.20,
      cached: 0.23,
      reasoning: 2.20,
      cache_creation: 0.45
    },
    "kimi-latest": {
      input: 0.55,
      output: 2.20,
      cached: 0.06,
      reasoning: 2.20,
      cache_creation: 0.55
    }
  },

  // MiniMax
  minimax: {
    "MiniMax-M2.1": {
      input: 0.27,
      output: 0.95,
      cached: 0.03,
      reasoning: 0.95,
      cache_creation: 0.27
    },
    "MiniMax-M2.5": {
      input: 0.30,
      output: 1.10,
      cached: 0.15,
      reasoning: 1.10,
      cache_creation: 0.30
    }
  }
};

/**
 * Get pricing for a specific provider and model
 * @param {string} provider - Provider ID (e.g., "openai", "cc", "gc")
 * @param {string} model - Model ID
 * @returns {object|null} Pricing object or null if not found
 */
export function getPricingForModel(provider, model) {
  if (!provider || !model) return null;

  const providerPricing = DEFAULT_PRICING[provider];
  if (!providerPricing) return null;

  return providerPricing[model] || null;
}

/**
 * Get all pricing data
 * @returns {object} All default pricing
 */
export function getDefaultPricing() {
  return DEFAULT_PRICING;
}

/**
 * Format cost for display
 * @param {number} cost - Cost in dollars
 * @returns {string} Formatted cost string
 */
export function formatCost(cost) {
  if (cost === null || cost === undefined || isNaN(cost)) return "$0.00";
  return `$${cost.toFixed(2)}`;
}

/**
 * Calculate cost from tokens and pricing
 * @param {object} tokens - Token counts
 * @param {object} pricing - Pricing object
 * @returns {number} Cost in dollars
 */
export function calculateCostFromTokens(tokens, pricing) {
  if (!tokens || !pricing) return 0;

  let cost = 0;

  // Input tokens (non-cached)
  const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
  const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens);

  cost += (nonCachedInput * (pricing.input / 1000000));

  // Cached tokens
  if (cachedTokens > 0) {
    const cachedRate = pricing.cached || pricing.input; // Fallback to input rate
    cost += (cachedTokens * (cachedRate / 1000000));
  }

  // Output tokens
  const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
  cost += (outputTokens * (pricing.output / 1000000));

  // Reasoning tokens
  const reasoningTokens = tokens.reasoning_tokens || 0;
  if (reasoningTokens > 0) {
    const reasoningRate = pricing.reasoning || pricing.output; // Fallback to output rate
    cost += (reasoningTokens * (reasoningRate / 1000000));
  }

  // Cache creation tokens
  const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
  if (cacheCreationTokens > 0) {
    const cacheCreationRate = pricing.cache_creation || pricing.input; // Fallback to input rate
    cost += (cacheCreationTokens * (cacheCreationRate / 1000000));
  }

  return cost;
}
