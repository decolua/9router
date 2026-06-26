import { KIRO_CONFIG, KIRO_EXTERNAL_IDP_DEFAULTS, assertValidAwsRegion } from "../constants/oauth.js";
import http from "http";
import { URL } from "url";

/**
 * Kiro OAuth Service
 * Supports multiple authentication methods:
 * 1. AWS Builder ID (Device Code Flow)
 * 2. AWS IAM Identity Center/IDC (Device Code Flow)
 * 3. Google/GitHub Social Login (Authorization Code Flow + Manual Callback)
 * 4. Import Token (Manual refresh token paste)
 */

const KIRO_AUTH_SERVICE = "https://prod.us-east-1.auth.desktop.kiro.dev";

// Tiny HTML escape for the loopback capture success/failure pages. Avoids
// pulling in a full DOM library for a few inline strings.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class KiroService {
  /**
   * Register OIDC client with AWS SSO
   * Returns clientId and clientSecret for device code flow
   */
  async registerClient(region = "us-east-1") {
    assertValidAwsRegion(region);
    const endpoint = `https://oidc.${region}.amazonaws.com/client/register`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientName: KIRO_CONFIG.clientName,
        clientType: KIRO_CONFIG.clientType,
        scopes: KIRO_CONFIG.scopes,
        grantTypes: KIRO_CONFIG.grantTypes,
        issuerUrl: KIRO_CONFIG.issuerUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register client: ${error}`);
    }

    const data = await response.json();
    return {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      clientSecretExpiresAt: data.clientSecretExpiresAt,
    };
  }

  /**
   * Start device authorization for AWS Builder ID or IDC
   */
  async startDeviceAuthorization(clientId, clientSecret, startUrl, region = "us-east-1") {
    assertValidAwsRegion(region);
    const endpoint = `https://oidc.${region}.amazonaws.com/device_authorization`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        startUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to start device authorization: ${error}`);
    }

    const data = await response.json();
    return {
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      verificationUri: data.verificationUri,
      verificationUriComplete: data.verificationUriComplete,
      expiresIn: data.expiresIn,
      interval: data.interval || 5,
    };
  }

  /**
   * Poll for token using device code (AWS Builder ID/IDC)
   */
  async pollDeviceToken(clientId, clientSecret, deviceCode, region = "us-east-1") {
    assertValidAwsRegion(region);
    const endpoint = `https://oidc.${region}.amazonaws.com/token`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = await response.json();

    // Handle pending/slow_down/errors
    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error,
        errorDescription: data.error_description,
        pending: data.error === "authorization_pending" || data.error === "slow_down",
      };
    }

    return {
      success: true,
      tokens: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
        tokenType: data.tokenType,
      },
    };
  }

  /**
   * Build Google/GitHub social login URL
   * Returns authorization URL for manual callback flow
   * Uses kiro:// custom protocol as required by AWS Cognito whitelist
   */
  buildSocialLoginUrl(provider, codeChallenge, state) {
    const idp = provider === "google" ? "Google" : "Github";
    // AWS Cognito only whitelists kiro:// protocol, not localhost
    const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";
    return `${KIRO_AUTH_SERVICE}/login?idp=${idp}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&prompt=select_account`;
  }

  /**
   * Exchange authorization code for tokens (Social Login)
   * Must use same redirect_uri as authorization request
   */
  async exchangeSocialCode(code, codeVerifier) {
    // Must match the redirect_uri used in buildSocialLoginUrl
    const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";

    const response = await fetch(`${KIRO_AUTH_SERVICE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      profileArn: data.profileArn,
      expiresIn: data.expiresIn || 3600,
    };
  }

  /**
   * Refresh token using refresh token
   */
  async refreshToken(refreshToken, providerSpecificData = {}) {
    const { authMethod, clientId, clientSecret, region } = providerSpecificData;

    // External IdP (Microsoft Entra ID) refresh — uses form-encoded OAuth2.
    if (authMethod === "external_idp") {
      return this.refreshExternalIdpToken(refreshToken, providerSpecificData);
    }

    // AWS SSO OIDC refresh (Builder ID or IDC)
    if (clientId && clientSecret) {
      const safeRegion = region || "us-east-1";
      assertValidAwsRegion(safeRegion);
      const endpoint = `https://oidc.${safeRegion}.amazonaws.com/token`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken,
          grantType: "refresh_token",
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
      }

      const data = await response.json();
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || refreshToken,
        profileArn: data.profileArn,
        expiresIn: data.expiresIn,
      };
    }

    // Social auth refresh (Google/GitHub)
    const response = await fetch(`${KIRO_AUTH_SERVICE}/refreshToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      profileArn: data.profileArn,
      expiresIn: data.expiresIn || 3600,
    };
  }

  /**
   * External IdP (Microsoft Entra ID / Azure AD) — build OAuth2 authorize URL.
   *
   * Standard public-client OAuth2 authorization code flow with PKCE. `issuerUrl`
   * is the tenant issuer (e.g. https://login.microsoftonline.com/{tenant}/v2.0
   * or https://login.microsoftonline.com/common/v2.0 for multi-tenant). The
   * `authorize` endpoint is discovered from `<issuerUrl>/.well-known/openid-configuration`,
   * but we also accept a fully-formed `authEndpoint` for callers that already
   * resolved OIDC metadata.
   *
   * Returns the fully-qualified authorize URL the user should be sent to.
   */
  buildExternalIdpAuthUrl({ issuerUrl, clientId, scopes, codeChallenge, state, redirectUri, authEndpoint }) {
    if (!clientId || !codeChallenge || !state) {
      throw new Error("external_idp authorize requires clientId, codeChallenge, state");
    }
    const endpoint = authEndpoint || `${issuerUrl.replace(/\/$/, "")}/oauth2/v2.0/authorize`;
    const finalScopes = scopes || KIRO_EXTERNAL_IDP_DEFAULTS.scopes;
    const finalRedirect = redirectUri || KIRO_EXTERNAL_IDP_DEFAULTS.redirectUri;

    const url = new URL(endpoint);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", finalRedirect);
    url.searchParams.set("scope", finalScopes);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("state", state);
    return url.toString();
  }

  /**
   * External IdP — exchange authorization code for tokens.
   *
   * Form-encoded body per RFC 6749 §4.1.3. Returns the raw token response
   * (accessToken, refreshToken, expiresIn, idToken, scope). The caller is
   * responsible for resolving a CodeWhisperer profile ARN via
   * `listAvailableProfiles` and storing the connection.
   */
  async exchangeExternalIdpCode({ issuerUrl, clientId, code, codeVerifier, redirectUri, scopes }) {
    if (!issuerUrl || !clientId || !code || !codeVerifier) {
      throw new Error("external_idp exchange requires issuerUrl, clientId, code, codeVerifier");
    }
    const tokenEndpoint = `${issuerUrl.replace(/\/$/, "")}/oauth2/v2.0/token`;
    const finalRedirect = redirectUri || KIRO_EXTERNAL_IDP_DEFAULTS.redirectUri;
    const finalScopes = scopes || KIRO_EXTERNAL_IDP_DEFAULTS.scopes;

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: finalRedirect,
      code_verifier: codeVerifier,
      scope: finalScopes,
    });

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`External IdP token exchange failed (${response.status}): ${errorText}`);
    }
    const data = await response.json();
    if (!data.access_token) {
      throw new Error("External IdP token response missing access_token");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in || 3600,
      idToken: data.id_token,
      scope: data.scope,
    };
  }

  /**
   * External IdP — refresh access token using refresh_token grant.
   */
  async refreshExternalIdpToken(refreshToken, providerSpecificData = {}) {
    const { issuerUrl, clientId, scopes, redirectUri } = providerSpecificData;
    if (!issuerUrl || !clientId) {
      throw new Error("external_idp refresh requires issuerUrl and clientId in providerSpecificData");
    }
    const tokenEndpoint = `${issuerUrl.replace(/\/$/, "")}/oauth2/v2.0/token`;
    const finalScopes = scopes || KIRO_EXTERNAL_IDP_DEFAULTS.scopes;

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: finalScopes,
    });

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`External IdP refresh failed (${response.status}): ${errorText}`);
    }
    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in || 3600,
      profileArn: providerSpecificData.profileArn,
    };
  }

  /**
   * Loopback capture server — binds 127.0.0.1:<port>, waits for one redirect
   * from the external IdP at `<redirectUri>`, returns the captured `code` and
   * `state`. The server is closed automatically after capture, on timeout,
   * or on `cancel()`.
   *
   * Used by the authorize route to receive the user's Microsoft redirect.
   * Returns a `{ promise, cancel }` pair so the caller can abort on route exit.
   */
  startLoopbackCapture({
    port = KIRO_EXTERNAL_IDP_DEFAULTS.loopbackPort,
    host = KIRO_EXTERNAL_IDP_DEFAULTS.loopbackHost,
    redirectPath = "/oauth/callback",
    expectedState,
    timeoutMs = KIRO_EXTERNAL_IDP_DEFAULTS.loopbackTimeoutMs,
  } = {}) {
    let server = null;
    let timeoutHandle = null;
    let resolveCapture;
    let rejectCapture;

    const promise = new Promise((resolve, reject) => {
      resolveCapture = resolve;
      rejectCapture = reject;

      server = http.createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url, `http://${req.headers.host}`);
          if (reqUrl.pathname !== redirectPath) {
            res.statusCode = 404;
            res.end("Not Found");
            return;
          }
          const code = reqUrl.searchParams.get("code");
          const state = reqUrl.searchParams.get("state");
          const error = reqUrl.searchParams.get("error");
          const errorDesc = reqUrl.searchParams.get("error_description");

          // Reply to the browser so the user sees a success/failure page.
          if (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(
              `<!doctype html><meta charset="utf-8"><title>9router — Sign-in failed</title>` +
              `<body style="font-family:system-ui;padding:2rem;max-width:40rem;margin:auto">` +
              `<h1>Sign-in failed</h1><p>${escapeHtml(error)}: ${escapeHtml(errorDesc || "")}</p>` +
              `<p>You can close this window and try again.</p></body>`
            );
            cleanup();
            rejectCapture(new Error(`external_idp callback error: ${error}`));
            return;
          }
          if (!code || !state) {
            res.statusCode = 400;
            res.end("Missing code or state");
            return;
          }
          if (expectedState && state !== expectedState) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(
              `<!doctype html><meta charset="utf-8"><title>9router — State mismatch</title>` +
              `<body style="font-family:system-ui;padding:2rem">` +
              `<h1>State mismatch</h1><p>This sign-in attempt does not match an active 9router session. You can close this window.</p></body>`
            );
            cleanup();
            rejectCapture(new Error("external_idp state mismatch"));
            return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            `<!doctype html><meta charset="utf-8"><title>9router — Signed in</title>` +
            `<body style="font-family:system-ui;padding:2rem;max-width:40rem;margin:auto">` +
            `<h1>Signed in to 9router</h1><p>You can close this window and return to 9router.</p>` +
            `<script>setTimeout(()=>window.close(),1500)</script></body>`
          );
          cleanup();
          resolveCapture({ code, state });
        } catch (err) {
          try { res.statusCode = 500; res.end("Internal error"); } catch {}
          cleanup();
          rejectCapture(err);
        }
      });

      timeoutHandle = setTimeout(() => {
        cleanup();
        rejectCapture(new Error("external_idp loopback capture timed out"));
      }, timeoutMs);

      server.once("error", (err) => {
        cleanup();
        rejectCapture(err);
      });

      server.listen(port, host, () => {
        // Listening; resolveCapture stays pending until callback fires.
      });
    });

    function cleanup() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = null;
      if (server) {
        try { server.close(); } catch {}
        server = null;
      }
    }

    function cancel() {
      cleanup();
      rejectCapture(new Error("external_idp loopback capture cancelled"));
    }

    return { promise, cancel };
  }

  /**
   * Validate and import refresh token
   */
  async validateImportToken(refreshToken) {
    // Validate token format
    if (!refreshToken.startsWith("aorAAAAAG")) {
      throw new Error("Invalid token format. Token should start with aorAAAAAG...");
    }

    // Try to refresh to validate
    try {
      const result = await this.refreshToken(refreshToken);
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken || refreshToken,
        profileArn: result.profileArn,
        expiresIn: result.expiresIn,
        authMethod: "imported",
      };
    } catch (error) {
      throw new Error(`Token validation failed: ${error.message}`);
    }
  }

  /**
   * List available CodeWhisperer profiles for a token (or API key) and return
   * the best-matching profileArn. AWS SSO OIDC logins return no profileArn, so
   * it must be fetched separately — the same call works for API-key auth.
   * Accepts both `arn` and `profileArn` response field names (the API-key
   * JSON-1.0 surface returns `arn`).
   */
  async listAvailableProfiles(accessToken, region = "us-east-1") {
    assertValidAwsRegion(region);
    const endpoint = `https://codewhisperer.${region}.amazonaws.com`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": "AmazonCodeWhispererService.ListAvailableProfiles",
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({ maxResults: 10 }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list profiles: ${error}`);
    }

    const data = await response.json();
    const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
    const arnOf = (p) => p?.arn || p?.profileArn || null;
    const match = profiles.find((p) => arnOf(p)?.split(":")[3] === region) || profiles[0];
    return arnOf(match);
  }

  /**
   * Validate an API-key credential by listing profiles with it. API keys are
   * long-lived bearer tokens (no refresh), so the only way to validate one is
   * to make an authenticated CodeWhisperer call. Returns a credential object
   * ready to persist as a "kiro" connection with authMethod="api_key".
   */
  async validateApiKey(apiKey, region = "us-east-1") {
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      throw new Error("API key is required");
    }
    const trimmed = apiKey.trim();

    let profileArn = null;
    try {
      profileArn = await this.listAvailableProfiles(trimmed, region);
    } catch (error) {
      throw new Error(`API key validation failed: ${error.message}`);
    }

    return {
      accessToken: trimmed,
      refreshToken: null,
      profileArn,
      region,
      authMethod: "api_key",
    };
  }

  /**
   * List available models from CodeWhisperer API
   */
  async listAvailableModels(accessToken, profileArn) {
    const endpoint = "https://codewhisperer.us-east-1.amazonaws.com";
    const target = "AmazonCodeWhispererService.ListAvailableModels";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": target,
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        origin: "AI_EDITOR",
        profileArn,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list models: ${error}`);
    }

    const data = await response.json();
    return (data.models || []).map(m => ({
      id: m.modelId,
      name: m.modelName || m.modelId,
      description: m.description,
      rateMultiplier: m.rateMultiplier,
      rateUnit: m.rateUnit,
      maxInputTokens: m.tokenLimits?.maxInputTokens || 0,
    }));
  }

  /**
   * Fetch user email from access token (optional, for display)
   */
  extractEmailFromJWT(accessToken) {
    try {
      const parts = accessToken.split(".");
      if (parts.length !== 3) return null;

      // Decode payload (add padding if needed)
      let payload = parts[1];
      while (payload.length % 4) {
        payload += "=";
      }

      const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      return decoded.email || decoded.preferred_username || decoded.sub;
    } catch {
      return null;
    }
  }
}
