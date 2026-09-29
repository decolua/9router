import { DEVIN_CONFIG } from "../constants/oauth.js";
import { generatePKCE } from "../utils/pkce.js";

export function buildDevinAuthUrl(config, redirectUri, state, codeChallenge) {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    state,
    prompt: "select_account",
    code_challenge: codeChallenge,
    code_challenge_method: config.codeChallengeMethod || "S256",
  });
  return `${config.authorizeUrl}?${params.toString()}`;
}

export function parseDevinCallback(raw, expectedState) {
  const value = String(raw || "").trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Devin callback must be a complete callback URL");
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) throw new Error("Devin callback missing authorization code");
  if (!state || state !== expectedState) throw new Error("Devin callback state mismatch");
  return { code, state };
}

export async function exchangeDevinToken(config, code, codeVerifier, fetchImpl = fetch) {
  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  });
  if (!response.ok) throw new Error(`Devin token exchange failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  if (typeof data?.token !== "string" || !data.token) throw new Error("Devin token exchange returned no token");
  return { accessToken: data.token, refreshToken: null, expiresIn: null, expiresAt: null };
}

const devin = {
  config: DEVIN_CONFIG,
  flowType: "authorization_code_pkce",
  fixedPort: DEVIN_CONFIG.callbackPort,
  callbackPath: DEVIN_CONFIG.callbackPath,
  prepareConfig: async (config) => config,
  buildAuthUrl: (config, redirectUri, state, codeChallenge) => buildDevinAuthUrl(config, redirectUri, state, codeChallenge),
  exchangeToken: async (config, code, redirectUri, codeVerifier, state) => {
    const callback = parseDevinCallback(code, state);
    return exchangeDevinToken(config, callback.code, codeVerifier);
  },
  mapTokens: (tokens) => ({
    accessToken: tokens.accessToken,
    refreshToken: null,
    expiresIn: null,
    expiresAt: null,
    providerSpecificData: {
      authMethod: "oauth",
      apiEndpoint: DEVIN_CONFIG.apiEndpoint,
      webEndpoint: DEVIN_CONFIG.webEndpoint,
    },
  }),
};

export function generateDevinPKCE() {
  return generatePKCE(96);
}

export default devin;
