/**
 * Local (default) vs hosted (public URL / remote VM).
 * Hosted is opt-in via env or a non-loopback BASE_URL.
 */

function trimSlash(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

export function getConfiguredBaseUrl() {
  return trimSlash(
    process.env.BASE_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      ""
  );
}

export function isLoopbackHostname(hostname) {
  if (!hostname) return false;
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function isLoopbackUrl(url) {
  if (!url) return true;
  try {
    return isLoopbackHostname(new URL(url).hostname);
  } catch {
    return true;
  }
}

/** Browser: public https origin that is not loopback. */
export function isHostedBrowser() {
  if (typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  return !isLoopbackHostname(window.location.hostname);
}

/**
 * True when running as a public/remote deploy.
 * Local npm/docker remain false unless DEPLOYMENT_MODE forces hosted.
 */
export function isHosted() {
  if (typeof window !== "undefined") return isHostedBrowser();

  const mode = (process.env.DEPLOYMENT_MODE || "").toLowerCase();
  if (mode === "hosted" || mode === "remote") return true;
  if (mode === "local") return false;

  const base = getConfiguredBaseUrl();
  if (base && !isLoopbackUrl(base)) return true;
  return false;
}

export function getPublicOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return getConfiguredBaseUrl() || "http://localhost:20128";
}
