import crypto from "crypto";
import { XAI_CONFIG, XAI_PKCE_VERIFIER_BYTES } from "../constants/xai.js";
import { validateXaiOAuthEndpoint, decodeXaiIdTokenEmail } from "../providerHelpers.js";

// Inlined from services/xai.js to keep web route bundle free of `open` (CLI-only) package
let cachedXaiDiscovery = null;

async function discoverXaiEndpoints() {
  if (cachedXaiDiscovery) return cachedXaiDiscovery;
  try {
    const res = await fetch(XAI_CONFIG.discoveryUrl, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      cachedXaiDiscovery = {
        authorizeUrl: validateXaiOAuthEndpoint(data.authorization_endpoint, "authorization_endpoint"),
        tokenUrl: validateXaiOAuthEndpoint(data.token_endpoint, "token_endpoint"),
      };
      return cachedXaiDiscovery;
    }
  } catch { /* fall through to static fallback */ }
  cachedXaiDiscovery = { authorizeUrl: XAI_CONFIG.authorizeUrl, tokenUrl: XAI_CONFIG.tokenUrl };
  return cachedXaiDiscovery;
}

const xai = {
  config: XAI_CONFIG,
  flowType: "authorization_code_pkce",
  fixedPort: XAI_CONFIG.loopbackPort,
  callbackPath: XAI_CONFIG.callbackPath,
  pkceVerifierBytes: XAI_PKCE_VERIFIER_BYTES,
  prepareConfig: async (config) => {
    const endpoints = await discoverXaiEndpoints();
    return {
      ...config,
      authorizeUrl: endpoints.authorizeUrl,
      tokenUrl: endpoints.tokenUrl,
    };
  },
  buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
    // Mirror CLIProxyAPI BuildAuthorizeURL: includes nonce, plan, referrer
    const nonce = crypto.randomBytes(16).toString("hex");
    const params = {
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scope,
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
      state,
      nonce,
      plan: "generic",
      referrer: "cli-proxy-api",
    };
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return `${config.authorizeUrl}?${qs}`;
  },
  exchangeToken: async (config, code, redirectUri, codeVerifier) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`xAI token exchange failed: ${error}`);
    }
    return await response.json();
  },
  mapTokens: (tokens) => {
    const mapped = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
    };
    const email = decodeXaiIdTokenEmail(tokens.id_token);
    if (email) mapped.email = email;
    if (tokens.id_token) {
      mapped.providerSpecificData = { idToken: tokens.id_token };
    }
    return mapped;
  },
};

export default xai;
