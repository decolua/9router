/**
 * Rate Limiting Middleware for 9Router/OmniRoute
 * 
 * Implements comprehensive rate limiting with:
 * - Sliding window algorithm
 * - Per-API key limits
 * - Per-provider limits
 * - Per-user limits
 * - Configurable windows
 * 
 * Usage:
 *   const rateLimiter = require('./rate-limiter');
 *   app.use('/v1/', rateLimiter.middleware);
 */

class RateLimiter {
  constructor(config = {}) {
    this.config = {
      global: { requests: 1000, window: 60000 }, // 1000 requests per minute
      perApiKey: { requests: 100, window: 60000 }, // 100 requests per minute
      perProvider: { requests: 50, window: 60000 }, // 50 requests per minute
      perUser: { requests: 200, window: 60000 }, // 200 requests per minute
      ...config
    };
    
    this.store = {
      global: new Map(),
      perApiKey: new Map(),
      perProvider: new Map(),
      perUser: new Map()
    };
    
    this.stats = {
      totalRequests: 0,
      blockedRequests: 0,
      byKey: {},
      byProvider: {}
    };
  }

  // Main middleware
  middleware(req, res, next) {
    const startTime = Date.now();
    
    // Extract identifiers
    const apiKey = this.extractApiKey(req);
    const provider = this.extractProvider(req);
    const user = this.extractUser(req);
    
    // Check rate limits
    const checks = [
      this.checkLimit('global', 'global', this.config.global),
      apiKey && this.checkLimit('perApiKey', apiKey, this.config.perApiKey),
      provider && this.checkLimit('perProvider', provider, this.config.perProvider),
      user && this.checkLimit('perUser', user, this.config.perUser)
    ].filter(Boolean);
    
    // Find first violation
    const violation = checks.find(check => !check.allowed);
    
    if (violation) {
      this.stats.blockedRequests++;
      return this.handleViolation(req, res, violation);
    }
    
    // Record request
    this.recordRequest('global', 'global');
    if (apiKey) this.recordRequest('perApiKey', apiKey);
    if (provider) this.recordRequest('perProvider', provider);
    if (user) this.recordRequest('perUser', user);
    
    // Add rate limit headers
    const limitInfo = this.getLimitInfo('global', 'global');
    res.set({
      'X-RateLimit-Limit': limitInfo.limit,
      'X-RateLimit-Remaining': limitInfo.remaining,
      'X-RateLimit-Reset': limitInfo.reset
    });
    
    this.stats.totalRequests++;
    next();
  }

  // Check if request is allowed
  checkLimit(type, identifier, config) {
    const now = Date.now();
    const windowStart = now - config.window;
    
    // Get or create entry
    if (!this.store[type].has(identifier)) {
      this.store[type].set(identifier, []);
    }
    
    const requests = this.store[type].get(identifier);
    
    // Clean old requests
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    this.store[type].set(identifier, validRequests);
    
    // Check limit
    const allowed = validRequests.length < config.requests;
    const remaining = Math.max(0, config.requests - validRequests.length);
    const resetTime = validRequests.length > 0 
      ? validRequests[0] + config.window 
      : now + config.window;
    
    return {
      allowed,
      limit: config.requests,
      remaining,
      reset: resetTime,
      type,
      identifier
    };
  }

  // Record request
  recordRequest(type, identifier) {
    const now = Date.now();
    
    if (!this.store[type].has(identifier)) {
      this.store[type].set(identifier, []);
    }
    
    this.store[type].get(identifier).push(now);
  }

  // Extract API key from request
  extractApiKey(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return req.headers['x-api-key'] || null;
  }

  // Extract provider from request
  extractProvider(req) {
    // Try to extract from model parameter
    if (req.body && req.body.model) {
      const parts = req.body.model.split('/');
      return parts[0] || null;
    }
    return null;
  }

  // Extract user from request
  extractUser(req) {
    // Implement your user extraction logic
    return req.headers['x-user-id'] || req.ip || null;
  }

  // Handle rate limit violation
  handleViolation(req, res, violation) {
    const retryAfter = Math.ceil((violation.reset - Date.now()) / 1000);
    
    res.set({
      'X-RateLimit-Limit': violation.limit,
      'X-RateLimit-Remaining': 0,
      'X-RateLimit-Reset': violation.reset,
      'Retry-After': retryAfter
    });
    
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Too many requests to ${violation.type}`,
      retryAfter,
      limit: violation.limit,
      remaining: 0,
      reset: new Date(violation.reset).toISOString()
    });
  }

  // Get limit info for headers
  getLimitInfo(type, identifier) {
    const config = this.config[type];
    const now = Date.now();
    const windowStart = now - config.window;
    
    const requests = this.store[type].get(identifier) || [];
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    
    return {
      limit: config.requests,
      remaining: Math.max(0, config.requests - validRequests.length),
      reset: validRequests.length > 0 
        ? validRequests[0] + config.window 
        : now + config.window
    };
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      stores: {
        global: this.store.global.size,
        perApiKey: this.store.perApiKey.size,
        perProvider: this.store.perProvider.size,
        perUser: this.store.perUser.size
      }
    };
  }

  // Reset limits for identifier
  resetLimits(type, identifier) {
    if (this.store[type]) {
      this.store[type].delete(identifier);
    }
  }

  // Update configuration
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
}

// Export singleton instance
module.exports = new RateLimiter();
