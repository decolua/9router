// Pure display helpers for the Proxy Pools dashboard.
// No mutation of stored data — all transformations are derive-on-render.

const RELAY_KINDS = ["vercel", "cloudflare", "deno"];

export const PROXY_KIND_ORDER = ["socks5", "http", ...RELAY_KINDS];

const KIND_LABELS = {
  socks5: "SOCKS5",
  http: "HTTP",
  vercel: "Vercel Relay",
  cloudflare: "Cloudflare Relay",
  deno: "Deno Relay",
};

const RELAY_NAME_LABELS = {
  vercel: "Vercel Relay",
  cloudflare: "Cloudflare Relay",
  deno: "Deno Relay",
};

function safeParseUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Mask credentials in a proxy URL for display.
 * Keeps protocol + host:port, hides any embedded user:pass.
 * Never returns the original credentials.
 */
export function maskProxyUrl(url) {
  if (!url || typeof url !== "string") return "";
  const parsed = safeParseUrl(url);
  if (parsed) {
    const proto = parsed.protocol.replace(/:$/, "");
    const hostPort = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    if (parsed.username || parsed.password) {
      return `${proto}://••••@${hostPort}`;
    }
    return `${proto}://${hostPort}`;
  }
  // Fallback: strip credentials via regex even if URL parsing fails.
  const stripped = url.replace(/\/\/[^/@]+@/, "//••••@");
  return stripped.length > 64 ? `${stripped.slice(0, 61)}…` : stripped;
}

/** host:port (no credentials) for search/match. Falls back to raw url. */
export function proxyHost(pool) {
  const url = pool?.proxyUrl || "";
  const parsed = safeParseUrl(url);
  if (parsed) return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  return url.replace(/\/\/[^/@]+@/, "//");
}

/**
 * Resolve the logical proxy kind.
 * Relay types come from `pool.type`; otherwise derived from the URL protocol
 * because imported socks5 proxies are stored with the default type "http".
 */
export function deriveProxyKind(pool) {
  if (!pool) return "http";
  const type = (pool.type || "").toLowerCase();
  if (RELAY_KINDS.includes(type)) return type;

  const parsed = safeParseUrl(pool.proxyUrl);
  const proto = parsed ? parsed.protocol.replace(/:$/, "").toLowerCase() : "";
  if (proto.startsWith("socks")) return "socks5";
  if (proto === "http" || proto === "https") return "http";
  if (proto) return proto;

  if ((pool.proxyUrl || "").toLowerCase().startsWith("socks")) return "socks5";
  return type || "http";
}

/** Group header label for a kind. */
export function kindGroupLabel(kind) {
  return KIND_LABELS[kind] || String(kind || "").toUpperCase() || "Other";
}

/**
 * Produce a human-friendly display name.
 * Auto-generated "Imported host:port" names become "SOCKS5 · host:port" etc.
 * User-chosen names are preserved as-is. Never mutates stored data.
 */
export function deriveDisplayName(pool) {
  if (!pool) return "";
  const name = pool.name || "";
  const kind = deriveProxyKind(pool);

  if (RELAY_NAME_LABELS[kind]) {
    if (name && !/^Imported\s+/i.test(name)) return name;
    return RELAY_NAME_LABELS[kind];
  }

  const imported = name.match(/^Imported\s+(.+)$/i);
  if (imported) {
    const hostPort = imported[1].trim();
    const label = kind === "socks5" ? "SOCKS5" : kind.toUpperCase();
    return `${label} · ${hostPort}`;
  }

  return name || proxyHost(pool);
}

/** Map raw testStatus to a clear health bucket. */
export function deriveHealth(pool) {
  const status = (pool?.testStatus || "unknown").toLowerCase();
  if (status === "active") return "healthy";
  if (status === "error") return "error";
  return "unknown";
}

/** Format latency for display, e.g. 312 -> "312ms", 1450 -> "1.4s". */
export function formatLatency(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return null;
  const value = Number(ms);
  if (value < 0) return null;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

/** Compact relative time, e.g. "just now", "2m ago", "3h ago", "5d ago". */
export function formatRelativeTime(value, now = Date.now()) {
  if (!value) return "Never";
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return "Never";
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
