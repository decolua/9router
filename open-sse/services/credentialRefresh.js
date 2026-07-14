// open-sse/services/credentialRefresh.js
//
// Single entry point for "make sure this provider's access token is fresh".
// The codebase has two refresh systems that used to require callers to know
// which a provider used:
//   - oauthCredentialManager.js: registry-model proactive refresh, driven by an
//     absolute `expiresAt` / `expiresIn` (shouldRefreshCredentials +
//     refreshProviderCredentials).
//   - tokenRefresh.js: legacy OAuth callback flow (getAccessToken /
//     refreshTokenByProvider), used by providers without an absolute expiry.
//
// This facade routes by credential shape so callers (chatCore, executors) stop
// caring which system applies. Behavior is unchanged for both paths.

import {
  shouldRefreshCredentials,
  refreshProviderCredentials,
} from "./oauthCredentialManager.js";
import { getAccessToken, refreshTokenByProvider } from "./tokenRefresh.js";

/**
 * Ensure `credentials` hold a fresh access token for `provider`.
 *
 * @param {string} provider
 * @param {object} credentials
 * @param {object} [log]
 * @returns {Promise<object>} credentials (refreshed if needed, else as-passed)
 */
export async function refreshProviderCredentialsUnified(provider, credentials, log) {
  // Registry model: absolute or relative expiry is tracked (expiresAt / expiresIn).
  if (credentials && (credentials.expiresAt || credentials.expiresIn != null)) {
    if (!shouldRefreshCredentials(provider, credentials)) return credentials;
    return refreshProviderCredentials(provider, credentials, log);
  }
  // Legacy OAuth model: no absolute expiry; resolve via the callback flow.
  return getAccessToken(provider, credentials, log);
}

// Back-compat aliases so existing direct callers keep working.
export const getProviderAccessToken = getAccessToken;
export const refreshProviderTokenByProvider = refreshTokenByProvider;
