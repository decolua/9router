/**
 * Parse Vertex AI Service Account JSON from apiKey string
 */
export function parseVertexSaJson(apiKey) {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey);
    if (
      parsed.type === "service_account" &&
      parsed.client_email &&
      parsed.private_key &&
      parsed.project_id
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Cache Vertex tokens keyed by service account email { token, expiresAt }
const vertexTokenCache = new Map();

/**
 * Mint a short-lived OAuth2 Bearer token for Google Cloud Vertex AI
 * using Service Account JSON + jose (RS256 JWT assertion flow).
 * Token is cached until 5 minutes before expiry.
 */
export async function refreshVertexToken(saJson, log) {
  const cacheKey = saJson.client_email;
  const cached = vertexTokenCache.get(cacheKey);

  // Return cached token if still valid (5-min buffer)
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return { accessToken: cached.token, expiresAt: cached.expiresAt };
  }

  try {
    const { SignJWT, importPKCS8 } = await import("jose");
    log?.debug?.(
      "TOKEN_REFRESH",
      `Vertex minting token for ${saJson.client_email}`,
    );
    const privateKey = await importPKCS8(
      saJson.private_key.replace(/\\n/g, "\n"),
      "RS256",
    );
    const now = Math.floor(Date.now() / 1000);

    const jwt = await new SignJWT({
      scope: "https://www.googleapis.com/auth/cloud-platform",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(saJson.client_email)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log?.error?.("TOKEN_REFRESH", `Vertex token mint failed: ${err}`);
      return null;
    }

    const { access_token, expires_in } = await res.json();
    const expiresAt = Date.now() + (expires_in ?? 3600) * 1000;

    vertexTokenCache.set(cacheKey, { token: access_token, expiresAt });
    log?.info?.(
      "TOKEN_REFRESH",
      `Vertex token minted for ${saJson.client_email}`,
    );

    return { accessToken: access_token, expiresAt };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Vertex token error: ${error.message}`);
    return null;
  }
}
