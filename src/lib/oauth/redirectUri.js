// OAuth redirect_uri construction for the authorization-code flow.
//
// The authorization server sends the browser to redirect_uri verbatim, so it
// has to name an origin that exists on the *user's* machine:
//
// - On a loopback install (local dev, or the CLI running 9router locally) the
//   loopback callback is the only thing that can work, and Claude Code's client
//   is registered against http://localhost:<app-port>/callback.
// - On a hosted or reverse-proxied install the browser is somewhere else
//   entirely, so a hardcoded http://localhost sends the user to their own
//   machine where nothing is listening. It is also worse than a plain loopback
//   guess: on an https origin window.location.port is empty and the implicit
//   port is 443, so the previous code emitted http://localhost:443/callback
//   (issue #4054) - a loopback origin that cannot exist behind a public domain.
//
// For any non-loopback origin the correct redirect target is the public base
// URL the user actually reached the dashboard on, i.e. window.location.origin.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const CODEX_LOOPBACK_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const XAI_LOOPBACK_REDIRECT_URI = "http://127.0.0.1:56121/callback";

export function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTNAMES.has(String(hostname || "").trim().toLowerCase());
}

// The public base URL, without a trailing slash. Falls back to protocol+host
// for environments that do not expose window.location.origin.
export function publicBaseUrl(location) {
  const origin = location?.origin;
  if (origin) return origin.replace(/\/+$/, "");
  return `${location?.protocol || "https:"}//${location?.host || ""}`.replace(/\/+$/, "");
}

/**
 * Build the redirect_uri to hand to the provider's authorization server.
 *
 * @param {object} location window.location ({ hostname, port, protocol, origin })
 * @param {string} provider provider id
 * @returns {string} absolute redirect_uri
 */
export function buildOAuthRedirectUri(location, provider) {
  // Fixed-port loopback flows: the CLI these providers pair with listens on a
  // known port, so the redirect is not ours to choose.
  if (provider === "codex") return CODEX_LOOPBACK_REDIRECT_URI;
  if (provider === "xai") return XAI_LOOPBACK_REDIRECT_URI;

  if (isLoopbackHostname(location?.hostname)) {
    const appPort = location.port || (location?.protocol === "https:" ? "443" : "80");
    return `http://localhost:${appPort}/callback`;
  }

  return `${publicBaseUrl(location)}/callback`;
}