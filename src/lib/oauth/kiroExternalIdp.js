const MICROSOFT_TOKEN_ENDPOINT_HOSTS = new Set([
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.windows.net",
]);

const DEFAULT_REGION = "us-east-1";
const DEFAULT_EXPIRES_IN = 3600;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateMicrosoftTokenEndpoint(rawEndpoint) {
  const tokenEndpoint = normalizeString(rawEndpoint);
  if (!tokenEndpoint) throw new Error("token_endpoint is required");

  let parsed;
  try {
    parsed = new URL(tokenEndpoint);
  } catch {
    throw new Error("token_endpoint must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("token_endpoint must use https");
  }

  const host = parsed.hostname.toLowerCase();
  if (!MICROSOFT_TOKEN_ENDPOINT_HOSTS.has(host)) {
    throw new Error("token_endpoint must be a Microsoft login endpoint");
  }

  return parsed.toString();
}

export function normalizeScope(scopes) {
  if (Array.isArray(scopes)) {
    return scopes.map(normalizeString).filter(Boolean).join(" ");
  }
  return normalizeString(scopes);
}

export function decodeJwtPayload(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (base64.length % 4)) % 4;
    return JSON.parse(Buffer.from(`${base64}${"=".repeat(padding)}`, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function resolveExpiresAt(input) {
  const explicit = input.expired || input.expires_at || input.expiresAt;
  if (explicit) {
    const ms = new Date(explicit).getTime();
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }

  const expiresIn = Number(input.expires_in || input.expiresIn || 0);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  const payload = decodeJwtPayload(input.access_token || input.accessToken);
  if (payload?.exp) {
    return new Date(payload.exp * 1000).toISOString();
  }

  return new Date(Date.now() + DEFAULT_EXPIRES_IN * 1000).toISOString();
}

export function normalizeKiroExternalIdpAuth(rawAuth) {
  let input = rawAuth;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      throw new Error("CLIProxyAPI auth JSON is invalid");
    }
  }

  if (!input || typeof input !== "object") {
    throw new Error("CLIProxyAPI auth JSON is required");
  }

  const authMethod = normalizeString(input.auth_method || input.authMethod);
  if (authMethod && authMethod !== "external_idp") {
    throw new Error("Only external_idp Kiro auth is supported by this importer");
  }

  const accessToken = normalizeString(input.access_token || input.accessToken);
  const refreshToken = normalizeString(input.refresh_token || input.refreshToken);
  const clientId = normalizeString(input.client_id || input.clientId);
  const tokenEndpoint = validateMicrosoftTokenEndpoint(input.token_endpoint || input.tokenEndpoint);
  const profileArn = normalizeString(input.profile_arn || input.profileArn);
  const region = normalizeString(input.region) || DEFAULT_REGION;
  const scope = normalizeScope(input.scopes || input.scope);

  if (!accessToken) throw new Error("access_token is required");
  if (!refreshToken) throw new Error("refresh_token is required");
  if (!clientId) throw new Error("client_id is required");
  if (!scope) throw new Error("scopes is required");
  if (!profileArn) throw new Error("profile_arn is required");

  const payload = decodeJwtPayload(accessToken);
  const email = input.email || payload?.email || payload?.preferred_username || payload?.upn || payload?.sub || null;

  return {
    accessToken,
    refreshToken,
    expiresAt: resolveExpiresAt(input),
    email,
    providerSpecificData: {
      profileArn,
      region,
      authMethod: "external_idp",
      provider: "CLIProxyAPI",
      clientId,
      tokenEndpoint,
      scope,
    },
  };
}

export function buildExternalIdpRefreshParams(refreshToken, providerSpecificData = {}) {
  const clientId = normalizeString(providerSpecificData.clientId || providerSpecificData.client_id);
  const tokenEndpoint = validateMicrosoftTokenEndpoint(providerSpecificData.tokenEndpoint || providerSpecificData.token_endpoint);
  const scope = normalizeScope(providerSpecificData.scope || providerSpecificData.scopes);

  if (!refreshToken) throw new Error("refresh token is required");
  if (!clientId) throw new Error("clientId is required for external_idp refresh");
  if (!scope) throw new Error("scope is required for external_idp refresh");

  return {
    tokenEndpoint,
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      scope,
    }),
    providerSpecificData: {
      ...providerSpecificData,
      authMethod: "external_idp",
      clientId,
      tokenEndpoint,
      scope,
    },
  };
}
