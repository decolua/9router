// Human-readable message for a failed dashboard fetch.
//
// Fixes #1160: dashboard panels (provider model list, quota/limits) used to render
// a bare `HTTP 401: Unauthorized` for two very different failures:
//   1. the browser's dashboard session expired (middleware rejects the request to
//      our own /api/* route before it runs — body has no JSON `error` field), and
//   2. the upstream provider rejected the token (our API route returns an explicit
//      `{ error: "Failed to fetch models: 401" }`).
// Users mistook (1) for a provider-token problem. Distinguish them so a session
// expiry points the user at re-login instead of looking like an upstream auth error.
//
// @param {number} status        HTTP status of the response
// @param {string} [statusText]  response.statusText (fallback only)
// @param {string} [dataError]   parsed `error` field from our API JSON body, if any
// @returns {string} message to display
export function describeFetchError(status, statusText = "", dataError = "") {
  // Our API routes always attach a descriptive `error` (e.g. "Failed to fetch
  // models: 401"); when present it already identifies the real cause, so prefer it.
  if (dataError) return dataError;

  // No JSON body → the request was blocked before reaching our route, i.e. the
  // dashboard session/auth, not the provider.
  if (status === 401) {
    return "Dashboard session expired or not authenticated — reload the page or log in again.";
  }
  if (status === 403) {
    return "Dashboard access denied — reload the page or log in again.";
  }

  return `HTTP ${status}${statusText ? `: ${statusText}` : ""}`;
}
