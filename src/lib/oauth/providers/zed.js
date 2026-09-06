import { ZED_HOSTED_CONFIG } from "../constants/oauth.js";
import {
  createZedNativeAuthData,
  parseZedCallbackPayload,
  decryptZedAccessToken,
  fetchZedAuthenticatedUser,
  resolveZedOrganizationId,
} from "open-sse/shared/zedAuth.js";

// Zed — RSA keypair native-app flow (NOT OAuth). prepareConfig generates a fresh
// keypair; buildAuthUrl returns the native_app_signin URL; exchangeToken decrypts
// the RSA-encrypted access token from the local callback.
const zed = {
  config: ZED_HOSTED_CONFIG,
  flowType: "authorization_code",
  callbackPath: "/",
  // prepareConfig mints a fresh RSA keypair — never re-run it during exchange.
  skipPrepareOnExchange: true,
  prepareConfig: async (config, meta) => {
    // native_app_port is the local callback port (passed via meta from start-proxy).
    const nativeAppPort = Number(meta?.nativeAppPort) || ZED_HOSTED_CONFIG.defaultNativeAppPort;
    const auth = createZedNativeAuthData(config, { nativeAppPort });
    return { ...config, ...auth };
  },
  buildAuthUrl: (config, redirectUri, state) => config.authUrl,
  exchangeToken: async (config, code, redirectUri, codeVerifier, state, meta = {}) => {
    // code = raw callback URL/query; codeVerifier = encoded private key verifier.
    const { userId, encryptedAccessToken } = parseZedCallbackPayload(code);
    const accessToken = decryptZedAccessToken(encryptedAccessToken, codeVerifier);
    // systemId must match the one embedded in the native_app_signin URL (session meta).
    return { accessToken, userId, systemId: meta.systemId || config.systemId || "" };
  },
  postExchange: async (tokens) => {
    const credentials = {
      accessToken: tokens.accessToken,
      providerSpecificData: { userId: tokens.userId, systemId: tokens.systemId },
    };
    let userInfo = null;
    try {
      userInfo = await fetchZedAuthenticatedUser(credentials, { config: ZED_HOSTED_CONFIG });
    } catch { /* best-effort */ }
    const organizationId = resolveZedOrganizationId(credentials, userInfo);
    return {
      userInfo,
      organizationId,
      email: userInfo?.email || null,
      name: userInfo?.name || userInfo?.display_name || null,
    };
  },
  mapTokens: (tokens, extra) => ({
    accessToken: tokens.accessToken,
    refreshToken: null,
    expiresIn: null,
    email: extra?.email || undefined,
    displayName: extra?.name || undefined,
    providerSpecificData: {
      authMethod: "oauth",
      userId: tokens.userId,
      systemId: tokens.systemId,
      organizationId: extra?.organizationId || "",
    },
  }),
};

export default zed;
