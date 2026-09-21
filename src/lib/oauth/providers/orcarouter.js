import {
  buildAuthorizeUrl,
  buildExchangeUrl,
  isAllowedOrcaOrigin,
  resolveAuthBase,
  ORCAROUTER_ID,
  ORCAROUTER_CONSOLE_URL,
} from "open-sse/providers/orcarouterCatalog.js";
import { PROVIDER_OAUTH } from "open-sse/providers/index.js";

export const ORCAROUTER_APP_NAME = "9Router";

/**
 * Auth origin resolution order: explicit `ORCA_AUTH_BASE_URL`, then the shared
 * self-hosted `ORCA_BASE_URL`, then the public default. Kept in one place so the
 * authorize URL and the exchange URL can never drift apart.
 */
export const ORCAROUTER_CONFIG = {
  ...PROVIDER_OAUTH[ORCAROUTER_ID],
  ...(() => {
    const authBase = resolveAuthBase(process.env);
    return { authBase, callbackUrl: "oob" };
  })(),
  appName: ORCAROUTER_APP_NAME,
  consoleUrl: ORCAROUTER_CONSOLE_URL,
};

function readKeyField(payload) {
  if (!payload || typeof payload !== "object") return null;
  for (const field of ["key", "api_key", "apiKey"]) {
    const value = payload[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Resolve the auth origin at request time so a self-hosted override
 * (`ORCA_AUTH_BASE_URL` / `ORCA_BASE_URL`) takes effect without a restart.
 * When no override is set, the provider config value wins.
 */
function currentAuthBase(config) {
  const hasEnvOverride = Boolean(process.env.ORCA_AUTH_BASE_URL || process.env.ORCA_BASE_URL);
  const envBase = resolveAuthBase(process.env);
  if (hasEnvOverride) return envBase;
  return config?.authBase || envBase;
}

function readUserIdField(payload) {
  if (!payload || typeof payload !== "object") return null;
  for (const field of ["user_id", "userId"]) {
    const value = payload[field];
    if (typeof value === "string" && value.trim()) return String(value).trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

const orcarouter = {
  config: ORCAROUTER_CONFIG,
  // PKCE code flow. Out-of-band delivery: 9Router is self-hosted, so its
  // install address and port differ per deployment and a loopback redirect is
  // not reliably reachable. `callback_url=oob` needs no registered redirect and
  // no predictable address; S256 is always sent.
  flowType: "authorization_code_pkce",

  buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
    const authBase = currentAuthBase(config);
    if (!isAllowedOrcaOrigin(authBase)) {
      throw new Error("OrcaRouter auth base must use HTTPS (HTTP is allowed only for loopback)");
    }
    return buildAuthorizeUrl({
      authBase,
      codeChallenge,
      state,
      appName: config?.appName,
      scope: config?.scope || "api",
      // Flow B: the literal string, spelled out, so the mode is asked for
      // rather than guessed at from an absent redirect URI.
      callbackUrl: config?.callbackUrl || "oob",
    });
  },

  exchangeToken: async (config, code, redirectUri, codeVerifier) => {
    const authBase = currentAuthBase(config);
    if (!isAllowedOrcaOrigin(authBase)) {
      throw new Error("OrcaRouter auth base must use HTTPS (HTTP is allowed only for loopback)");
    }

    // Read every field through the body parser: an `await` on res.json() is
    // evaluated before res.status is read, so a non-JSON error page would
    // otherwise throw the raw HTML body instead of a status.
    const res = await fetch(buildExchangeUrl({ authBase }), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        code_challenge_method: "S256",
      }),
    });
    const status = res.status;
    let payload = null;
    let raw = "";
    try {
      raw = await res.text();
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!res.ok) {
      // 403 covers unknown/expired/already-used codes and a verifier that does
      // not match the stored challenge; 400 is a challenge-method downgrade.
      // Never echo the response body — it can carry credential material.
      const detail = payload?.error_description || payload?.error || payload?.message;
      throw new Error(
        `OrcaRouter authorization failed (${status})${detail ? `: ${detail}` : ""}`
      );
    }

    const key = readKeyField(payload);
    if (!key) {
      throw new Error("OrcaRouter returned no API key");
    }

    return {
      key,
      scope: typeof payload?.scope === "string" ? payload.scope : null,
      userId: readUserIdField(payload),
      // Which fields were present, never their values: safe to persist/log.
      hasUserId: Boolean(readUserIdField(payload)),
    };
  },

  mapTokens: (tokens) => {
    const scope = tokens.scope || null;
    // The exchange returns the scope that was *granted*, which can be narrower
    // than the one requested. Surface the mismatch instead of assuming it.
    if (scope && scope !== "api") {
      console.warn(
        `[orcarouter] granted scope is "${scope}", not "api" — the account may have fewer permissions than requested`
      );
    }

    // The connect flow issues no OIDC ID token, so identity comes from the
    // exchange response. A deterministic per-user value keeps a repeat login on
    // the same connection row instead of accumulating one account per login.
    const userId = tokens.userId ? String(tokens.userId) : "";

    return {
      // The PKCE flow issues a durable API key, not an OAuth access/refresh
      // pair. It is stored where every other provider secret lives, reused
      // until OrcaRouter revokes it, and never refreshed (see
      // open-sse/services/tokenRefresh.js).
      accessToken: tokens.key,
      refreshToken: null,
      apiKey: tokens.key,
      scope,
      email: userId ? `orcarouter-user-${userId}` : null,
      displayName: "OrcaRouter",
      providerSpecificData: {
        authMethod: "pkce",
        grantedScope: scope,
        userId: userId || null,
        ...(userId ? { username: `orcarouter-user-${userId}` } : {}),
        authorizedAppsUrl: ORCAROUTER_CONSOLE_URL,
      },
    };
  },
};

export default orcarouter;
