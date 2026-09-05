// Dashboard-safe OAuth status derivation — never returns token material.
//
// Distinct from `hasUsableToken` in oauthRefresh.js (which answers
// "is a token usable right now for a live upstream call?"). This answers
// "what auth state should the UI show?" and stays consistent with the
// refresh path's semantics.

/**
 * Derive a dashboard-safe OAuth status from a stored token bundle.
 * Never returns token material.
 * @param {boolean} oauth        instance.oauth flag
 * @param {object | null | undefined} tokens  parsed oauthTokens
 * @returns {"none" | "needs_login" | "connected"}
 */
export function deriveOauthStatus(oauth, tokens) {
  if (!oauth) return "none";
  if (!tokens || typeof tokens !== "object") return "needs_login";
  if (tokens.needsReauth) return "needs_login";
  if (typeof tokens.access_token !== "string" || !tokens.access_token) {
    return "needs_login";
  }
  // Expired access token with a refresh_token -> refresh path will recover it.
  if (
    typeof tokens.expires_at === "number" &&
    Date.now() >= tokens.expires_at &&
    !tokens.refresh_token
  ) {
    return "needs_login";
  }
  return "connected";
}
