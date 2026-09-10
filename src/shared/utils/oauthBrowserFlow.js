export const CODEX_LOOPBACK_REDIRECT_URI = "http://localhost:1455/auth/callback";

export function isLoopbackBrowserHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function hasMatchingOAuthState(expectedState, receivedState) {
  return Boolean(expectedState && receivedState && expectedState === receivedState);
}
