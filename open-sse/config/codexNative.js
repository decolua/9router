export const CODEX_NATIVE_CONFIG = Object.freeze({
  providerId: "codex",
  providerConfigId: "9router_codex",
  upstreamHttpBaseUrl: "https://chatgpt.com/backend-api/codex",
  upstreamWebSocketUrl: "wss://chatgpt.com/backend-api/codex/responses",
  catalogTtlMs: 15 * 60 * 1000,
  catalogStaleMs: 7 * 24 * 60 * 60 * 1000,
  quotaTtlMs: 60 * 1000,
  affinityTtlMs: 7 * 24 * 60 * 60 * 1000,
  affinityMaxEntries: 50_000,
  leaseTtlMs: 65 * 60 * 1000,
  quotaThresholds: Object.freeze({
    drainRemainingPercent: 15,
    criticalRemainingPercent: 5,
    recoverRemainingPercent: 20,
  }),
  paths: Object.freeze({
    models: "models",
    responses: "responses",
    compact: "responses/compact",
    memories: "memories/trace_summarize",
    search: "alpha/search",
    imageGenerations: "images/generations",
    imageEdits: "images/edits",
  }),
});

// Client credentials and hop-by-hop routing metadata must never reach ChatGPT.
export const CODEX_NATIVE_BLOCKED_REQUEST_HEADERS = Object.freeze([
  "authorization",
  "chatgpt-account-id",
  "cookie",
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  "x-9r-real-ip",
  "x-9r-via-proxy",
  "x-9r-cli-token",
  "x-9r-internal-secret",
]);

export const CODEX_NATIVE_SAFE_REQUEST_HEADERS = Object.freeze([
  "accept",
  "accept-encoding",
  "accept-language",
  "content-type",
  "openai-beta",
  "originator",
  "session-id",
  "thread-id",
  "traceparent",
  "tracestate",
  "baggage",
  "user-agent",
  "x-client-request-id",
]);

export const CODEX_NATIVE_SAFE_REQUEST_PREFIXES = Object.freeze([
  "x-codex-",
  "x-openai-",
  "x-stainless-",
]);

export const CODEX_NATIVE_SAFE_RESPONSE_HEADERS = Object.freeze([
  "cache-control",
  "content-encoding",
  "content-type",
  "etag",
  "openai-model",
  "retry-after",
  "x-codex-turn-state",
  "x-models-etag",
  "x-reasoning-included",
  "x-request-id",
]);

export const CODEX_NATIVE_SAFE_RESPONSE_PREFIXES = Object.freeze([
  "openai-",
  "x-codex-",
  "x-openai-",
  "x-ratelimit-",
  "x-request-",
  "x-stainless-",
]);
