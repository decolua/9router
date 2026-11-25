export const ERROR_CATEGORY = Object.freeze({
  INVALID: "auth_invalid", EXPIRED: "auth_expired", RATE: "rate_limited",
  QUOTA: "quota_exhausted", UPSTREAM: "upstream_error", TIMEOUT: "timeout",
  NETWORK: "network", BAD: "bad_request", UNKNOWN: "unknown",
});

export const OAUTH_PERMANENT_MARKERS = [
  "refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated", "invalid_grant",
];
export const REVOKED = /(?:token|grant|credential)[\w -]{0,24}revoked|unrecoverable_refresh_error/i;
export const EXHAUSTED = /insufficient_quota|quota[_ ]exhausted|exceeded your current quota|usage_limit_reached|premium request allowance.*exceeded/i;
export const TIMED_OUT = /timeout|timed out|ETIMEDOUT/i;
export const NETWORK_FAILURE = /fetch failed|network error|socket hang up|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_SOCKET/i;
export const RESET_HEADERS = ["ratelimit-reset", "x-ratelimit-reset", "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens",
  "anthropic-ratelimit-unified-reset", "anthropic-ratelimit-requests-reset", "anthropic-ratelimit-tokens-reset"];
