// Cloudflare quick tunnel: DNS propagates fast, short timeouts OK
export const HEALTH_CHECK = {
  intervalMs: 2000,
  timeoutMs: 60000,
  fetchTimeoutMs: 5000,
  dnsTimeoutMs: 2000,
};

export const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://abc-tunnel.us";

// Opt-in: when the worker's TLS chain ends in a self-signed cert (Cloudflare
// Access origin, internal proxy), Node's default verifier rejects the
// handshake and surfaces only "fetch failed". Setting
// TUNNEL_WORKER_INSECURE=1 disables verification for the worker host only.
function parseBool(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}
export const INSECURE_WORKER = parseBool(process.env.TUNNEL_WORKER_INSECURE);
