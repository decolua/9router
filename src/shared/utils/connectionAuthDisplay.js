export function canRefreshCodexGoConnection(connection) {
  return connection?.provider === "codex" && connection?.providerSpecificData?.authMethod === "codexgo";
}

export function getConnectionAuthDisplay(connection, isOAuth) {
  const rowAuthType = connection?.authType || (isOAuth ? "oauth" : "apikey");
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";

  if (canRefreshCodexGoConnection(connection)) {
    return {
      authIcon: "sync",
      authLabel: "CodexGo",
      isOAuthConnection: true,
      isCookieConnection: false,
    };
  }

  return {
    authIcon: isCookieConnection ? "cookie" : isOAuthConnection ? "lock" : "key",
    authLabel: isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key",
    isOAuthConnection,
    isCookieConnection,
  };
}

