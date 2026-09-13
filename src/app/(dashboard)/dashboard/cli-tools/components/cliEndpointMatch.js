// Match a configured CLI base URL against all known endpoints (local/cloud)
const stripTrailingSlash = (s) => (s || "").replace(/\/+$/, "");

export function matchKnownEndpoint(currentUrl, opts = {}) {
  if (!currentUrl) return false;
  const url = stripTrailingSlash(currentUrl);
  const { cloudUrl } = opts;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) return true;
  if (cloudUrl && url.startsWith(stripTrailingSlash(cloudUrl))) return true;
  return false;
}
