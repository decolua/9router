import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";

/**
 * Determine whether a connection is eligible for usage tracking.
 * OAuth connections are always eligible; apikey connections only for
 * whitelisted providers. Both "apikey" and "api_key" spellings are accepted.
 *
 * @returns {{ isOAuth: boolean, isEligible: boolean }}
 */
export function checkUsageEligibility(connection) {
  if (!connection) return { isOAuth: false, isEligible: false };
  const isOAuth = connection.authType === "oauth";
  const isApikeyAuth = connection.authType === "apikey" || connection.authType === "api_key";
  const isEligible = isOAuth || (isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider));
  return { isOAuth, isEligible };
}
