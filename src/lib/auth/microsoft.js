/**
 * Microsoft OAuth Configuration
 * Supports Microsoft Entra ID (Azure AD) authentication
 */

export const MICROSOFT_OAUTH_CONFIG = {
  // OAuth endpoints
  authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  
  // Scopes: User.Read required for Microsoft Graph /me (profile); openid profile email for claims
  scope: "openid profile email User.Read",
  
  // Config from environment
  get clientId() {
    return process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID || null;
  },
  
  get clientSecret() {
    return process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET || null;
  },

  /** Set to "true" if app is registered as public client (SPA/native). Do not send client_secret when true. */
  get isPublicClient() {
    return process.env.MICROSOFT_PUBLIC_CLIENT === "true";
  },
  
  get tenantId() {
    // Optional: specific tenant ID for single-tenant apps
    // Use 'common' for multi-tenant, 'organizations' for org accounts only
    return process.env.MICROSOFT_TENANT_ID || "common";
  },
  
  // Check if Microsoft OAuth is enabled (public client: clientId only; confidential: clientId + clientSecret)
  get isEnabled() {
    const useMicrosoft = process.env.USE_MICROSOFT_OAUTH === "true";
    const hasConfig = this.isPublicClient ? !!this.clientId : !!(this.clientId && this.clientSecret);
    return useMicrosoft && hasConfig;
  },
  
  // Get redirect URI based on base URL
  getRedirectUri(baseUrl) {
    return `${baseUrl}/api/auth/callback/microsoft`;
  },
  
  // Build authorization URL (PKCE required by Microsoft for cross-origin code redemption)
  getAuthorizationUrl(state, baseUrl, codeChallenge) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.getRedirectUri(baseUrl),
      scope: this.scope,
      response_mode: "query",
      state: state,
    });
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return `${this.authorizeUrl}?${params.toString()}`;
  },
};

/**
 * Exchange authorization code for access token.
 * Public client: PKCE only (no client_secret). Confidential: client_secret and optionally PKCE.
 */
export async function exchangeCodeForToken(code, baseUrl, codeVerifier) {
  const params = new URLSearchParams({
    client_id: MICROSOFT_OAUTH_CONFIG.clientId,
    code: code,
    redirect_uri: MICROSOFT_OAUTH_CONFIG.getRedirectUri(baseUrl),
    grant_type: "authorization_code",
  });
  if (MICROSOFT_OAUTH_CONFIG.isPublicClient) {
    // AADSTS700025: public client must not send client_secret
    if (!codeVerifier) throw new Error("PKCE code_verifier is required for public client");
    params.set("code_verifier", codeVerifier);
  } else {
    if (MICROSOFT_OAUTH_CONFIG.clientSecret) {
      params.set("client_secret", MICROSOFT_OAUTH_CONFIG.clientSecret);
    }
    if (codeVerifier) params.set("code_verifier", codeVerifier);
  }
  const response = await fetch(MICROSOFT_OAUTH_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }
  
  return await response.json();
}

/**
 * Fetch user profile from Microsoft Graph API
 */
export async function fetchMicrosoftUserProfile(accessToken) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
    },
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch user profile: ${error}`);
  }
  
  return await response.json();
}
