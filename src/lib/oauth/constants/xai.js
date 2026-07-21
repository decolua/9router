/**
 * xAI (Grok) OAuth Configuration
 *
 * Source of truth: router-for-me/CLIProxyAPI internal/auth/xai/types.go
 * Mirrors the upstream Go constants 1:1.
 */
import { PROVIDERS } from "open-sse/providers/index.js";

// xAI client_id for OAuth (PKCE public client) — single source: registry xai.transport
export const XAI_CLIENT_ID = PROVIDERS["xai"]?.clientId;

// OAuth issuer + endpoints
export const XAI_ISSUER = "https://auth.x.ai";
export const XAI_AUTH_ENDPOINT_PATH = "/oauth2/authorize";
export const XAI_TOKEN_ENDPOINT_PATH = "/oauth2/token";
export const XAI_DISCOVERY_PATH = "/.well-known/openid-configuration";

// Scopes (space-separated, matches Go upstream)
export const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";

// xAI inference API base URL
export const XAI_API_BASE = "https://api.x.ai/v1";

// Loopback callback (PKCE)
export const XAI_LOOPBACK_PORT = 56121;
export const XAI_CALLBACK_PATH = "/callback";
export const XAI_REDIRECT_URI = `http://127.0.0.1:${XAI_LOOPBACK_PORT}${XAI_CALLBACK_PATH}`;

// PKCE verifier length (bytes pre-base64url)
export const XAI_PKCE_VERIFIER_BYTES = 96;

// Refresh tokens this many seconds before expiry
export const XAI_REFRESH_LEAD_SECONDS = 5 * 60;

// User-Agent — mirror Go grok-cli UA. Version is best-effort; xAI does not pin a specific version.
export const XAI_USER_AGENT = "grok-cli/9router";

/**
 * Aggregated config object — mirrors the shape of CLAUDE_CONFIG/CODEX_CONFIG in oauth.js.
 * Includes both the discovery-derived defaults and the static fallbacks used when
 * discovery is unavailable. Discovery results override authorizeUrl/tokenUrl at runtime.
 */
export const XAI_CONFIG = {
  clientId: XAI_CLIENT_ID,
  issuer: XAI_ISSUER,
  authEndpointPath: XAI_AUTH_ENDPOINT_PATH,
  tokenEndpointPath: XAI_TOKEN_ENDPOINT_PATH,
  discoveryPath: XAI_DISCOVERY_PATH,
  // Static fallbacks (these are also the values returned by xAI discovery today)
  authorizeUrl: `${XAI_ISSUER}${XAI_AUTH_ENDPOINT_PATH}`,
  tokenUrl: `${XAI_ISSUER}${XAI_TOKEN_ENDPOINT_PATH}`,
  discoveryUrl: `${XAI_ISSUER}${XAI_DISCOVERY_PATH}`,
  scope: XAI_SCOPE,
  apiBaseUrl: XAI_API_BASE,
  redirectUri: XAI_REDIRECT_URI,
  loopbackPort: XAI_LOOPBACK_PORT,
  callbackPath: XAI_CALLBACK_PATH,
  pkceVerifierBytes: XAI_PKCE_VERIFIER_BYTES,
  refreshLeadSeconds: XAI_REFRESH_LEAD_SECONDS,
  userAgent: XAI_USER_AGENT,
  codeChallengeMethod: "S256",
};
