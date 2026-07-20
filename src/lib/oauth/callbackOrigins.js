const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseOrigin(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url;
  } catch {
    return null;
  }
}

function isLoopback(url) {
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

export function isPermittedOAuthOpenerOrigin(candidateOrigin, dashboardOrigin) {
  const candidate = parseOrigin(candidateOrigin);
  const dashboard = parseOrigin(dashboardOrigin);
  if (!candidate || !dashboard) return false;
  if (candidate.origin === dashboard.origin) return true;
  return isLoopback(candidate) && isLoopback(dashboard) &&
    candidate.protocol === dashboard.protocol && candidate.port === dashboard.port;
}

export function getPermittedOAuthOpenerOrigins(callbackOrigin) {
  const callback = parseOrigin(callbackOrigin);
  if (!callback) return [];
  if (!isLoopback(callback)) return [callback.origin];
  const suffix = callback.port ? `:${callback.port}` : "";
  return [
    `${callback.protocol}//localhost${suffix}`,
    `${callback.protocol}//127.0.0.1${suffix}`,
    `${callback.protocol}//[::1]${suffix}`,
  ];
}
