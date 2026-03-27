// HTTP status codes
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// OpenAI-compatible error types mapping
export const ERROR_TYPES = {
  [HTTP_STATUS.BAD_REQUEST]: { type: "invalid_request_error", code: "bad_request" },
  [HTTP_STATUS.UNAUTHORIZED]: { type: "authentication_error", code: "invalid_api_key" },
  [HTTP_STATUS.FORBIDDEN]: { type: "permission_error", code: "insufficient_quota" },
  [HTTP_STATUS.NOT_FOUND]: { type: "invalid_request_error", code: "model_not_found" },
  [HTTP_STATUS.NOT_ACCEPTABLE]: { type: "invalid_request_error", code: "model_not_supported" },
  [HTTP_STATUS.RATE_LIMITED]: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  [HTTP_STATUS.SERVER_ERROR]: { type: "server_error", code: "internal_server_error" },
  [HTTP_STATUS.BAD_GATEWAY]: { type: "server_error", code: "bad_gateway" },
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: { type: "server_error", code: "service_unavailable" },
  [HTTP_STATUS.GATEWAY_TIMEOUT]: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code
export const DEFAULT_ERROR_MESSAGES = {
  [HTTP_STATUS.BAD_REQUEST]: "Bad request",
  [HTTP_STATUS.UNAUTHORIZED]: "Invalid API key provided",
  [HTTP_STATUS.FORBIDDEN]: "You exceeded your current quota",
  [HTTP_STATUS.NOT_FOUND]: "Model not found",
  [HTTP_STATUS.NOT_ACCEPTABLE]: "Model not supported",
  [HTTP_STATUS.RATE_LIMITED]: "Rate limit exceeded",
  [HTTP_STATUS.SERVER_ERROR]: "Internal server error",
  [HTTP_STATUS.BAD_GATEWAY]: "Bad gateway - upstream provider error",
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: "Service temporarily unavailable",
  [HTTP_STATUS.GATEWAY_TIMEOUT]: "Gateway timeout"
};

// Cache TTLs (seconds)
export const CACHE_TTL = {
  userInfo: 300,    // 5 minutes
  modelAlias: 3600  // 1 hour
};

// Memory management config
export const MEMORY_CONFIG = {
  sessionTtlMs: 2 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
  dnsCacheTtlMs: 5 * 60 * 1000,
  proxyDispatchersMaxSize: 20,
};

// Default token limits
export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

// Retry config for 429 responses (legacy - kept for backward compatibility)
export const RETRY_CONFIG = {
  maxAttempts: 2,
  delayMs: 2000
};

// Default retry config by status code (number of retry attempts)
export const DEFAULT_RETRY_CONFIG = {
  429: 2,   // Rate limit - retry 2 times
  503: 0,   // Service unavailable - no retry
  502: 0    // Bad gateway - no retry
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 1000,
  max: 2 * 60 * 1000,
  maxLevel: 15
};

// Error-based cooldown times
export const COOLDOWN_MS = {
  unauthorized: 2 * 60 * 1000,
  paymentRequired: 2 * 60 * 1000,
  notFound: 2 * 60 * 1000,
  transient: 30 * 1000,
  requestNotAllowed: 5 * 1000,
  // Legacy aliases
  rateLimit: 2 * 60 * 1000,
  serviceUnavailable: 2 * 1000,
  authExpired: 2 * 60 * 1000
};

// Requests containing these texts will bypass provider
export const SKIP_PATTERNS = [
  "Please write a 5-10 word title for the following conversation:"
];
