import { normalizeHostHeaderHostname } from "./host";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isTrustedOAuthMessageOrigin(origin, currentOrigin) {
  if (!origin) return false;
  if (origin === currentOrigin) return true;
  try {
    const url = new URL(origin);
    const host = normalizeHostHeaderHostname(url.host || url.hostname);
    return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}
