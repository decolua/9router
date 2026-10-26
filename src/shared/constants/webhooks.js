// Operational webhook catalog and bounded policy.
// Pure data only: no DB, no transport, no runtime side effects.

export const WEBHOOK_SCHEMA_VERSION = 1;

// Only events backed by real terminal signals. Do not invent provider.down,
// quota, health-poll or budget events here.
export const WEBHOOK_EVENT_CATALOG = Object.freeze({
  "request.failed": Object.freeze({ severity: "error", defaultSubscribed: true }),
  "account.unavailable": Object.freeze({ severity: "warning", defaultSubscribed: false }),
  "token.refresh_failed": Object.freeze({ severity: "warning", defaultSubscribed: false }),
});

export const WEBHOOK_EVENT_TYPES = Object.freeze(Object.keys(WEBHOOK_EVENT_CATALOG));

export const DEFAULT_WEBHOOK_EVENTS = Object.freeze(
  WEBHOOK_EVENT_TYPES.filter((type) => WEBHOOK_EVENT_CATALOG[type].defaultSubscribed),
);

export const WEBHOOK_DESTINATION_KINDS = Object.freeze(["discord", "slack", "generic"]);

// Internal only. Never accepted from CRUD, settings or user event payloads.
export const WEBHOOK_DELIVERY_KINDS = Object.freeze(["operational", "test"]);

export const WEBHOOK_ERROR_CLASSES = Object.freeze([
  "upstream_http",
  "upstream_network",
  "upstream_timeout",
  "no_credentials",
  "all_unavailable",
  "stream_failed",
  "refresh_failed",
  "internal",
]);

export const WEBHOOK_LIMITS = Object.freeze({
  nameMaxLength: 80,
  urlMaxLength: 2048,
  cooldownMinSeconds: 0,
  cooldownMaxSeconds: 3600,
  cooldownDefaultSeconds: 300,
  maxDestinations: 20,
  maxHeaders: 8,
  headerValueMaxLength: 2048,
  maxPayloadBytes: 16 * 1024,
  signingSecretMaxLength: 2048,
  eventStringMaxLength: 256,
});

// Fields owned by persistence or the dispatcher. Rejecting them on input keeps
// deliveryKind (contract B1) from being forged through CRUD.
export const WEBHOOK_INTERNAL_INPUT_KEYS = Object.freeze(["deliveryKind"]);

// Header names that are routing, transport, signature or credential carriers.
// The allowlist is already Authorization + X-*, so this closes the X-* escape
// hatch that would otherwise let a destination spoof forwarding/signature state.
export const WEBHOOK_FORBIDDEN_HEADER_NAMES = Object.freeze([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "forwarded",
  "via",
  "cookie",
  "set-cookie",
  "origin",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "x-original-url",
  "x-rewrite-url",
  "webhook-id",
  "webhook-timestamp",
  "webhook-signature",
  "x-webhook-id",
  "x-webhook-timestamp",
  "x-webhook-signature",
]);

export const WEBHOOK_RESERVED_HEADER_PREFIXES = Object.freeze(["x-forwarded-"]);
