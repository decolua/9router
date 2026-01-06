// Default pricing rates for AI models
// All rates are in dollars per million tokens ($/1M tokens)
// Based on user-provided pricing for Antigravity models and industry standards for others

export const DEFAULT_PRICING = {
  // OAuth Providers (using aliases)

  // Claude Code (cc)
  cc: {
    "claude-opus-4-5-20251101": {
      input: 15.00,
      output: 75.00,
      cached: 7.50,
      reasoning: 75.00,
      cache_creation: 15.00
    },
    "claude-sonnet-4-5-20250929": {
      input: 3.00,
      output: 15.00,
      cached: 1.50,
      reasoning: 15.00,
      cache_creation: 3.00
    },
    "claude-haiku-4-5-20251001": {
      input: 0.50,
      output: 2.50,
      cached: 0.25,
      reasoning: 2.50,
      cache_creation: 0.50
    }
  },

  // OpenAI Codex (cx)
  cx: {
    "gpt-5.2-codex": {
      input: 5.00,
      output: 20.00,
      cached: 2.50,
      reasoning: 30.00,
      cache_creation: 5.00
    },
    "gpt-5.2": {
      input: 5.00,
      output: 20.00,
      cached: 2.50,
      reasoning: 30.00,
      cache_creation: 5.00
    },
    "gpt-5.1-codex-max": {
      input: 8.00,
      output: 32.00,
      cached: 4.00,
      reasoning: 48.00,
      cache_creation: 8.00
    },
    "gpt-5.1-codex": {
      input: 4.00,
      output: 16.00,
      cached: 2.00,
      reasoning: 24.00,
      cache_creation: 4.00
    },
    "gpt-5.1-codex-mini": {
      input: 1.50,
      output: 6.00,
      cached: 0.75,
      reasoning: 9.00,
      cache_creation: 1.50
    },
    "gpt-5.1": {
      input: 4.00,
      output: 16.00,
      cached: 2.00,
      reasoning: 24.00,
      cache_creation: 4.00
    },
    "gpt-5-codex": {
      input: 3.00,
      output: 12.00,
      cached: 1.50,
      reasoning: 18.00,
      cache_creation: 3.00
    },
    "gpt-5-codex-mini": {
      input: 1.00,
      output: 4.00,
      cached: 0.50,
      reasoning: 6.00,
      cache_creation: 1.00
    }
  },

  // Gemini CLI (gc)
  gc: {
    "gemini-3-flash-preview": {
      input: 0.50,
      output: 3.00,
      cached: 0.03,
      reasoning: 4.50,
      cache_creation: 0.50
    },
    "gemini-3-pro-preview": {
      input: 2.00,
      output: 12.00,
      cached: 0.25,
      reasoning: 18.00,
      cache_creation: 2.00
    },
    "gemini-2.5-pro": {
      input: 2.00,
      output: 12.00,
      cached: 0.25,
      reasoning: 18.00,
      cache_creation: 2.00
    },
    "gemini-2.5-flash": {
      input: 0.30,
      output: 2.50,
      cached: 0.03,
      reasoning: 3.75,
      cache_creation: 0.30
    },
    "gemini-2.5-flash-lite": {
      input: 0.15,
      output: 1.25,
      cached: 0.015,
      reasoning: 1.875,
      cache_creation: 0.15
    }
  },

  // Qwen Code (qw)
  qw: {
    "qwen3-coder-plus": {
      input: 1.00,
      output: 4.00,
      cached: 0.50,
      reasoning: 6.00,
      cache_creation: 1.00
    },
    "qwen3-coder-flash": {
      input: 0.50,
      output: 2.00,
      cached: 0.25,
      reasoning: 3.00,
      cache_creation: 0.50
    },
    "vision-model": {
      input: 1.50,
      output: 6.00,
      cached: 0.75,
      reasoning: 9.00,
      cache_creation: 1.50
    }
  },

  // iFlow AI (if)
  if: {
    "qwen3-coder-plus": {
      input: 1.00,
      output: 4.00,
      cached: 0.50,
      reasoning: 6.00,
      cache_creation: 1.00
    },
    "kimi-k2": {
      input: 1.00,
      output: 4.00,
      cached: 0.50,
      reasoning: 6.00,
      cache_creation: 1.00
    },
    "kimi-k2-thinking": {
      input: 1.50,
      output: 6.00,
      cached: 0.75,
      reasoning: 9.00,
      cache_creation: 1.50
    },
    "deepseek-r1": {
      input: 0.75,
      output: 3.00,
      cached: 0.375,
      reasoning: 4.50,
      cache_creation: 0.75
    },
    "deepseek-v3.2-chat": {
      input: 0.50,
      output: 2.00,
      cached: 0.25,
      reasoning: 3.00,
      cache_creation: 0.50
    },
    "deepseek-v3.2-reasoner": {
      input: 0.75,
      output: 3.00,
      cached: 0.375,
      reasoning: 4.50,
      cache_creation: 0.75
    },
    "minimax-m2": {
      input: 0.50,
      output: 2.00,
      cached: 0.25,
      reasoning: 3.00,
      cache_creation: 0.50
    },
    "glm-4.6": {
      input: 0.50,
      output: 2.00,
      cached: 0.25,
      reasoning: 3.00,
      cache_creation: 0.50
    },
    "glm-4.7": {
      input: 0.75,
      output: 3.00,
      cached: 0.375,
      reasoning: 4.50,
      cache_creation: 0.75
    }
  },

  // Antigravity (ag) - User-provided pricing
  ag: {
    "gemini-3-pro-low": {
      input: 2.00,
      output: 12.00,
      cached: 0.25,
      reasoning: 18.00,
      cache_creation: 2.00
    },
    "gemini-3-pro-high": {
      input: 4.00,
      output: 18.00,
      cached: 0.50,
      reasoning: 27.00,
      cache_creation: 4.00
    },
    "gemini-3-flash": {
      input: 0.50,
      output: 3.00,
      cached: 0.03,
      reasoning: 4.50,
      cache_creation: 0.50
    },
    "gemini-2.5-flash": {
      input: 0.30,
      output: 2.50,
      cached: 0.03,
      reasoning: 3.75,
      cache_creation: 0.30
    },
    "claude-sonnet-4-5": {
      input: 3.00,
      output: 15.00,
      cached: 0.30,
      reasoning: 22.50,
      cache_creation: 3.00
    },
    "claude-sonnet-4-5-thinking": {
      input: 3.00,
      output: 15.00,
      cached: 0.30,
      reasoning: 22.50,
      cache_creation: 3.00
    },
    "claude-opus-4-5-thinking": {
      input: 5.00,
      output: 25.00,
      cached: 0.50,
      reasoning: 37.50,
      cache_creation: 5.00
    }
  },

  // GitHub Copilot (gh)
  gh: {
    "gpt-5": {
      input: 3.00,
      output: 12.00,
      cached: 1.50,
      reasoning: 18.00,
      cache_creation: 3.00
    },
    "gpt-5-mini": {
      input: 0.75,
      output: 3.00,
      cached: 0.375,
      reasoning: 4.50,
      cache_creation: 0.75
    },
    "gpt-5.1-codex": {
      input: 4.00,
      output: 16.00,
      cached: 2.00,
      reasoning: 24.00,
      cache_creation: 4.00
    },
    "gpt-5.1-codex-max": {
      input: 8.00,
      output: 32.00,
      cached: 4.00,
      reasoning: 48.00,
      cache_creation: 8.00
    },
    "gpt-4.1": {
      input: 2.50,
      output: 10.00,
      cached: 1.25,
      reasoning: 15.00,
      cache_creation: 2.50
    },
    "claude-4.5-sonnet": {
      input: 3.00,
      output: 15.00,
      cached: 0.30,
      reasoning: 22.50,
      cache_creation: 3.00
    },
    "claude-4.5-opus": {
      input: 5.00,
      output: 25.00,
      cached: 0.50,
      reasoning: 37.50,
      cache_creation: 5.00
    },
    "claude-4.5-haiku": {
      input: 0.50,
      output: 2.50,
      cached: 0.05,
      reasoning: 3.75,
      cache_creation: 0.50
    },
    "gemini-3-pro": {
      input: 2.00,
      output: 12.00,
      cached: 0.25,
      reasoning: 18.00,
      cache_creation: 2.00
    },
    "gemini-3-flash": {
      input: 0.50,
      output: 3.00,
      cached: 0.03,
      reasoning: 4.50,
      cache_creation: 0.50
    },
    "gemini-2.5-pro": {
      input: 2.00,
      output: 12.00,
      cached: 0.25,
      reasoning: 18.00,
      cache_creation: 2.00
    },
    "grok-code-fast-1": {
      input: 0.50,
      output: 2.00,
      cached: 0.25,
      reasoning: 3.00,
      cache_creation: 0.50
    }
  },

  // API Key Providers (alias = id)

  // OpenAI
  openai: {
    "gpt-4o": {
      input: 2.50,
      output: 10.00,
      cached: 1.25,
      reasoning: 15.00,
      cache_creation: 2.50
    },
    "gpt-4o-mini": {
      input: 0.15,
      output: 0.60,
      cached: 0.075,
      reasoning: 0.90,
      cache_creation: 0.15
    },
    "gpt-4-turbo": {
      input: 10.00,
      output: 30.00,
      cached: 5.00,
      reasoning: 45.00,
      cache_creation: 10.00
    },
    "o1": {
      input: 15.00,
      output: 60.00,
      cached: 7.50,
      reasoning: 90.00,
      cache_creation: 15.00
    },
    "o1-mini": {
      input: 3.00,
      output: 12.00,
      cached: 1.50,
      reasoning: 18.00,
      cache_creation: 3.00
    }
  },

  // Anthropic
  anthropic: {
    "claude-sonnet-4-20250514": {
      input: 3.00,
      output: 15.00,
      cached: 1.50,
      reasoning: 15.00,
      cache_creation: 3.00
    },
    "claude-opus-4-20250514": {
      input: 15.00,
      output: 75.00,
      cached: 7.50,
      reasoning: 112.50,
      cache_creation: 15.00
    },
    "claude-3-5-sonnet-20241022": {
      input: 3.00,
      output: 15.00,
      cached: 1.50,
      reasoning: 15.00,
      cache_creation: 3.00
    }
  },

  // Gemini
  gemini: {
    "gemini-3-pro-preview": {
      input: 2.00,
      output: 12.00,
      cached: 0.25,
      reasoning: 18.00,
      cache_creation: 2.00
    },
    "gemini-2.5-pro": {
      input: 2.00,
      output: 12.00,
      cached: 0.25,
      reasoning: 18.00,
      cache_creation: 2.00
    },
    "gemini-2.5-flash": {
      input: 0.30,
      output: 2.50,
      cached: 0.03,
      reasoning: 3.75,
      cache_creation: 0.30
    },
    "gemini-2.5-flash-lite": {
      input: 0.15,
      output: 1.25,
      cached: 0.015,
      reasoning: 1.875,
      cache_creation: 0.15
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
      input: 0.75,
      output: 3.00,
      cached: 0.375,
      reasoning: 4.50,
      cache_creation: 0.75
    },
    "glm-4.6": {
      input: 0.50,
      output: 2.00,
      cached: 0.25,
      reasoning: 3.00,
      cache_creation: 0.50
    },
    "glm-4.6v": {
      input: 0.75,
      output: 3.00,
      cached: 0.375,
      reasoning: 4.50,
      cache_creation: 0.75
    }
  },

  // Kimi
  kimi: {
    "kimi-latest": {
      input: 1.00,
      output: 4.00,
      cached: 0.50,
      reasoning: 6.00,
      cache_creation: 1.00
    }
  },

  // MiniMax
  minimax: {
    "MiniMax-M2.1": {
      input: 0.50,
      output: 2.00,
      cached: 0.25,
      reasoning: 3.00,
      cache_creation: 0.50
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