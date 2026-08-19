function hasValue(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

/**
 * Whether a stored connection has enough secret material to be sent to a
 * provider. An OAuth refresh token can be sufficient when the access token
 * has expired, but a row with no credential fields must never be selected.
 */
export function hasUsableConnectionCredentials(connection) {
  if (!connection || typeof connection !== "object") return false;

  const hasApiKey = hasValue(connection.apiKey);
  const hasOAuthToken = hasValue(connection.accessToken)
    || hasValue(connection.refreshToken)
    || hasValue(connection.idToken);

  switch (connection.authType) {
    case "apikey":
    case "cookie":
      return hasApiKey;
    case "oauth":
    case "access_token":
      return hasOAuthToken || hasApiKey;
    default:
      return hasApiKey || hasOAuthToken;
  }
}

export function needsConnectionReauth(connection) {
  return !hasUsableConnectionCredentials(connection);
}
