/**
 * Sensitive providers that must never fall back to the host's direct IP when
 * outbound proxying fails. Enforcement is applied both at connection write-time
 * and at request credential assembly time.
 */
export const STRICT_PROXY_PROVIDERS = Object.freeze([
  "antigravity",
  "xai",
  "github",
]);

const STRICT_PROXY_PROVIDER_SET = new Set(STRICT_PROXY_PROVIDERS);

export function shouldForceStrictProxy(providerId) {
  if (typeof providerId !== "string") return false;
  return STRICT_PROXY_PROVIDER_SET.has(providerId.trim());
}

/**
 * Resolve the effective strictProxy flag from connection/storage/runtime signals.
 * Sensitive providers always win (true).
 */
export function resolveStrictProxyFlag({
  providerId,
  connectionStrictProxy = false,
  nestedStrictProxy = false,
  resolvedStrictProxy = false,
} = {}) {
  if (shouldForceStrictProxy(providerId)) return true;
  return connectionStrictProxy === true
    || nestedStrictProxy === true
    || resolvedStrictProxy === true;
}

/**
 * Ensure sensitive provider connection payloads always store strictProxy at both
 * top-level and nested providerSpecificData seams.
 * Returns a new object; never mutates the input.
 */
export function withStrictProxyEnforced(data = {}) {
  if (!data || typeof data !== "object") return data;
  if (!shouldForceStrictProxy(data.provider)) return data;

  const providerSpecificData = data.providerSpecificData && typeof data.providerSpecificData === "object"
    ? { ...data.providerSpecificData, strictProxy: true }
    : { strictProxy: true };

  return {
    ...data,
    strictProxy: true,
    providerSpecificData,
  };
}
