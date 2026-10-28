// Custom JSON nodes reuse compatible-provider routing and the OpenAI translator bridge.
export const CUSTOM_JSON_API_TYPE = "custom-json";
// In-process marker only: business operations must not be repeated by routing fallback.
export const CUSTOM_JSON_NO_FALLBACK = Symbol.for("9router.customJson.noFallback");
export const CUSTOM_JSON_RETRY_CONFIG = Object.fromEntries([429, 500, 502, 503, 504].map((status) => [status, { attempts: 0 }]));
export const CUSTOM_JSON_DEFAULTS = {
  method: "POST",
  authType: "bearer",
  authHeader: "X-API-Key",
  headers: {},
  requestTemplate: { model: "{{model}}", messages: "{{messages}}" },
  responsePath: "choices[0].message.content",
};
export const CUSTOM_JSON_METHODS = ["POST", "PUT", "PATCH"];
export const CUSTOM_JSON_AUTH_TYPES = ["bearer", "api-key", "none"];
export const CUSTOM_JSON_VARIABLES = ["prompt", "messages", "model", "stream", "request"];
export const CUSTOM_JSON_MAX_TEMPLATE_SIZE = 65536;
export const CUSTOM_JSON_MAX_DEPTH = 32;
export const CUSTOM_JSON_BLOCKED_KEYS = ["__proto__", "prototype", "constructor"];
export const CUSTOM_JSON_BLOCKED_HEADERS = ["host", "content-length", "content-type", "connection", "transfer-encoding", "authorization", "cookie"];
