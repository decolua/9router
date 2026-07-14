// Pure helpers for avoiding stale one-time refresh-token reuse.
// Codex/OpenAI uses Auth0 rotating refresh tokens: a refresh token can be used
// once, and duplicate use may revoke the whole token family. These helpers are
// kept dependency-free so the race behavior can be tested without DB imports.

export function hasRotatingRefreshToken(provider) {
  // Keep this conservative. Other providers either do not rotate, or tolerate
  // duplicate refresh attempts better than Auth0 Codex.
  return provider === "codex";
}

export function mergeDbCredentials(creds, dbConn) {
  if (!dbConn) return creds;
  return {
    ...creds,
    accessToken: dbConn.accessToken || creds.accessToken,
    refreshToken: dbConn.refreshToken || creds.refreshToken,
    expiresAt: dbConn.expiresAt || creds.expiresAt,
    providerSpecificData: dbConn.providerSpecificData
      ? { ...(creds.providerSpecificData || {}), ...dbConn.providerSpecificData }
      : creds.providerSpecificData,
    projectId: dbConn.projectId || creds.projectId,
  };
}

export function resolveRotatedDbCredentials(provider, creds, dbConn) {
  if (!hasRotatingRefreshToken(provider) || !creds.connectionId || !creds.refreshToken) {
    return { creds, wasRotated: false };
  }

  if (!dbConn?.refreshToken || dbConn.refreshToken === creds.refreshToken) {
    return { creds, wasRotated: false };
  }

  return { creds: mergeDbCredentials(creds, dbConn), wasRotated: true };
}
