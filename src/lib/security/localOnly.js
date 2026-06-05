const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(value) {
  const host = String(value || "").trim().toLowerCase();
  if (!host) return null;

  const bracketedIpv6 = host.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6) return bracketedIpv6[1];

  if (host === "::1") return host;

  const colonIndex = host.indexOf(":");
  if (colonIndex === -1) return host;
  if (host.indexOf(":", colonIndex + 1) !== -1) return null;
  return host.slice(0, colonIndex);
}

function isLoopbackHostname(value) {
  if (!value) return false;
  const hostnames = String(value).split(",").map(normalizeHostname);
  return hostnames.length > 0 && hostnames.every((hostname) => LOOPBACK_HOSTS.has(hostname));
}

function isLoopbackOrigin(value) {
  if (!value) return true;
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isLocalOnlyRequest(request) {
  const headers = request?.headers;
  if (!headers?.get) return false;

  // #1114: MCP route handlers spawn local stdio plugins, so they enforce
  // loopback Host/Origin here even if middleware is bypassed or relaxed.
  if (!isLoopbackHostname(headers.get("host"))) return false;
  if (!isLoopbackOrigin(headers.get("origin"))) return false;

  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost && !isLoopbackHostname(forwardedHost)) return false;

  return true;
}

export function localOnlyJsonError(message = "Local only: requires localhost access") {
  return Response.json({ error: message }, { status: 403 });
}
