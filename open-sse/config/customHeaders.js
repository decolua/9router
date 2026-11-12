// Custom outbound headers for OpenAI/Anthropic Compatible provider nodes.
// Single source of truth for limits, denylist, placeholder and mask sentinel —
// shared by the node APIs (save-time validation), the executor (apply-time
// re-validation) and the dashboard modals (client-side UX checks).

// Only user-defined compatible nodes accept custom headers. Built-in and OAuth
// providers keep their registry-driven headers untouched.
export const CUSTOM_HEADER_PROVIDER_PREFIXES = ["openai-compatible-", "anthropic-compatible-"];

export const CUSTOM_HEADERS_MAX_COUNT = 20;
export const CUSTOM_HEADER_NAME_MAX_LENGTH = 256;
export const CUSTOM_HEADER_VALUE_MAX_LENGTH = 4096;

// RFC 7230 §3.2.6 token (tchar+)
export const CUSTOM_HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// Replaced with the connection's API key at request time.
export const CUSTOM_HEADER_API_KEY_PLACEHOLDER = "{{API_KEY}}";

// Returned instead of a stored value by every API response. On save/check an
// entry carrying this exact value means "keep the stored value for this name".
// It contains U+2022 (> 0xFF), which validation rejects as a real header value,
// so it can never collide with a legitimate value.
export const CUSTOM_HEADER_MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

// Case-insensitive names a user may never set. Request-framing / hop-by-hop
// headers would let a node desync or smuggle the upstream request; the rest are
// owned by the transport:
// - content-type: the executor always serializes a JSON body; a different type
//   only breaks upstream parsing and has no legitimate use here.
// - expect: undici rejects it ("expect header not supported") → every request fails.
// - http2-settings: hop-by-hop h2c upgrade header (RFC 7540 §3.2.1).
export const CUSTOM_HEADER_DENYLIST = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "upgrade",
  "te",
  "trailer",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "expect",
  "http2-settings",
]);
