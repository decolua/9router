/**
 * One place that turns a client API-key verdict into the answer a caller should get.
 *
 * `validateApiKey()` reports a reason string for every per-key limit, so a comparison
 * against truthiness is what let an over-quota, expired or restricted key through the
 * endpoints that only asked `if (!valid)`. Pure, so any handler can use it.
 */
const KEY_GATE_FAILURES = {
  KEY_DISABLED: { status: 403, message: "API key is disabled" },
  KEY_EXPIRED: { status: 403, message: "API key has expired" },
  IP_NOT_ALLOWED: { status: 403, message: "Client IP is not authorized to use this API key" },
  MODEL_NOT_ALLOWED: { status: 403, message: "This model is not allowed for the API key" },
  QUOTA_EXCEEDED: { status: 429, message: "API key token limit exceeded" },
  RPM_EXCEEDED: { status: 429, message: "API key rate limit exceeded (RPM limit reached)" },
  TPM_EXCEEDED: { status: 429, message: "API key rate limit exceeded (TPM limit reached)" },
};

/**
 * @param {true | false | string} valid verdict from validateApiKey()
 * @param {boolean} requireApiKey whether the gateway demands a key at all
 * @returns {null | { status: number, message: string }} null lets the request through
 */
export function apiKeyGateFailure(valid, requireApiKey = true) {
  if (valid === true) return null;
  // A key the owner switched off stays off, even while the gateway runs open.
  if (valid === "KEY_DISABLED") return KEY_GATE_FAILURES.KEY_DISABLED;
  if (!requireApiKey) return null;
  return KEY_GATE_FAILURES[valid] || { status: 401, message: "Invalid API key" };
}
