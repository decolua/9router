/**
 * Proxy resolution shared by the OpenCode transport hop and the request path.
 *
 * `resolveEffectiveProxyUrl` answers "which HTTP proxy would this request
 * leave through?" without creating a dispatcher, so the Bun sidecar can be
 * handed the same egress the in-process path would have used.
 */

/** Trim to a non-empty string; anything else becomes "". */
export function normalizeString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function matchNoProxy(hostname, noProxy) {
  const list = normalizeString(noProxy);
  if (!list || !hostname) return false;
  const host = hostname.toLowerCase();
  return list
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      if (entry.startsWith(".")) return host === entry.slice(1) || host.endsWith(entry);
      return host === entry || host.endsWith(`.${entry}`);
    });
}

function withScheme(value) {
  const raw = normalizeString(value);
  if (!raw) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
}

/**
 * Resolve the proxy URL a request to `url` would use.
 *
 * Order: relay, connection proxy (honouring NO_PROXY), then the process env
 * proxy. Returns `{ url, source }`; `url` is "" when the request goes direct.
 *
 * @param {string} url
 * @param {object|null} proxyOptions
 * @returns {{ url: string, source: string }}
 */
export function resolveEffectiveProxyUrl(url, proxyOptions = null) {
  let hostname = "";
  let protocol = "https:";
  try {
    const parsed = new URL(String(url));
    hostname = parsed.hostname;
    protocol = parsed.protocol;
  } catch {
    return { url: "", source: "invalid" };
  }

  const relay = normalizeString(proxyOptions?.vercelRelayUrl);
  if (relay) return { url: relay, source: "relay" };

  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  const connectionProxy = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (enabled && connectionProxy) {
    // A NO_PROXY match on the connection proxy means "bypass it", which is what
    // the in-process fetch does too. Report that instead of falling through to
    // the env proxy and sending the request out through a different egress.
    if (matchNoProxy(hostname, proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy)) {
      return { url: "", source: "no_proxy" };
    }
    return { url: withScheme(connectionProxy), source: "connection" };
  }

  if (matchNoProxy(hostname, process.env.NO_PROXY || process.env.no_proxy)) {
    return { url: "", source: "no_proxy" };
  }

  const envProxy = protocol === "https:"
    ? process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy
    : process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  const normalizedEnv = normalizeString(envProxy);
  if (normalizedEnv) return { url: withScheme(normalizedEnv), source: "env" };

  return { url: "", source: "direct" };
}
