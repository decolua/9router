/**
 * Token Bucket Rate Limiter for 9Router
 * Prevents 429 errors by enforcing per-provider/model rate limits proactively
 */

import { DEFAULT_RATE_LIMITS } from "../config/rateLimits.js";
import { getProviderModels } from "../config/providerModels.js";

export class TokenBucketRateLimiter {
  constructor() {
    this.buckets = new Map(); // key: "provider:model" -> BucketState
    this.config = new Map();  // key: "provider:model" -> RateLimitConfig
    this.globalConfig = { defaultRpm: 60, defaultBurst: 10 };
    this._initialized = false;
  }

  /**
   * Initialize rate limiter with default configs
   */
  initialize() {
    if (this._initialized) return;
    
    // Configure from defaults
    for (const [provider, limits] of Object.entries(DEFAULT_RATE_LIMITS)) {
      const models = getProviderModels(provider);
      for (const model of models) {
        const modelLimits = limits.models?.[model.id] ?? limits;
        this.configure(provider, model.id, modelLimits);
      }
    }
    
    this._initialized = true;
  }

  /**
   * Configure rate limit for a provider/model
   * @param {string} provider - Provider ID (e.g., 'nvidia', 'cerebras')
   * @param {string} model - Model ID (e.g., 'deepseek-v4-flash')
   * @param {Object} options
   * @param {number} options.rpm - Requests per minute (sustained)
   * @param {number} options.burst - Max burst capacity
   * @param {number} [options.cost=1] - Tokens consumed per request
   */
  configure(provider, model, { rpm, burst, cost = 1 } = {}) {
    const key = `${provider}:${model}`;
    this.config.set(key, { 
      rpm: rpm ?? this.globalConfig.defaultRpm,
      burst: burst ?? this.globalConfig.defaultBurst,
      cost,
      refillRate: (rpm ?? this.globalConfig.defaultRpm) / 60
    });
    // Initialize bucket if not exists
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        tokens: this.config.get(key).burst,
        lastRefill: Date.now(),
        capacity: this.config.get(key).burst,
        refillRate: this.config.get(key).refillRate
      });
    }
  }

  /**
   * Configure from provider registry (auto-discovery)
   */
  configureFromRegistry(getProviderModelsFn) {
    // Known free tier limits (community-sourced)
    const FREE_TIER_LIMITS = {
      'nvidia': { rpm: 60, burst: 10 },
      'cerebras': { rpm: 30, burst: 5 },
      'groq': { rpm: 30, burst: 10 },
      'openrouter': { rpm: 20, burst: 5 }, // free models
      'ollama': { rpm: 100, burst: 20 },
      'mistral': { rpm: 60, burst: 10 }, // trial
      'cohere': { rpm: 60, burst: 10 },  // trial
      'together': { rpm: 60, burst: 10 },
      'fireworks': { rpm: 60, burst: 10 },
      'deepseek': { rpm: 60, burst: 10 },
      'sambanova': { rpm: 20, burst: 5 },
    };

    for (const [provider, limits] of Object.entries(FREE_TIER_LIMITS)) {
      const models = getProviderModelsFn(provider);
      for (const model of models) {
        this.configure(provider, model.id, limits);
      }
    }
  }

  /**
   * Try to acquire tokens for a request
   * @returns {Promise<{allowed: boolean, retryAfter: number, bucketState: BucketState}>}
   */
  async acquire(provider, model, tokens = 1) {
    // Ensure initialized
    if (!this._initialized) this.initialize();
    
    const key = `${provider}:${model}`;
    const cfg = this.config.get(key) || { 
      rpm: this.globalConfig.defaultRpm, 
      burst: this.globalConfig.defaultBurst,
      cost: 1,
      refillRate: this.globalConfig.defaultRpm / 60
    };
    
    let bucket = this.buckets.get(key);
    const now = Date.now();
    
    if (!bucket) {
      bucket = {
        tokens: cfg.burst,
        lastRefill: now,
        capacity: cfg.burst,
        refillRate: cfg.refillRate
      };
      this.buckets.set(key, bucket);
    }
    
    // Refill based on elapsed time
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsedSeconds * bucket.refillRate);
    bucket.lastRefill = now;
    
    const cost = cfg.cost * tokens;
    
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { 
        allowed: true, 
        retryAfter: 0, 
        bucketState: { ...bucket, key }
      };
    }
    
    // Calculate wait time
    const deficit = cost - bucket.tokens;
    const retryAfter = Math.ceil(deficit / bucket.refillRate);
    
    return { 
      allowed: false, 
      retryAfter, 
      bucketState: { ...bucket, key }
    };
  }

  /**
   * Get current bucket state without consuming tokens
   */
  getState(provider, model) {
    const key = `${provider}:${model}`;
    return this.buckets.get(key) || null;
  }

  /**
   * Get all bucket states (for metrics/dashboard)
   */
  getAllStates() {
    return Object.fromEntries(this.buckets);
  }

  /**
   * Reset bucket (e.g., after provider recovery)
   */
  reset(provider, model) {
    const key = `${provider}:${model}`;
    const cfg = this.config.get(key);
    if (cfg) {
      this.buckets.set(key, {
        tokens: cfg.burst,
        lastRefill: Date.now(),
        capacity: cfg.burst,
        refillRate: cfg.refillRate
      });
    }
  }

  /**
   * Force open (maintenance mode)
   */
  forceOpen(provider, model) {
    const key = `${provider}:${model}`;
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.tokens = 0;
    }
  }
}

export const rateLimiter = new TokenBucketRateLimiter();