// Cloudflare quick tunnel: DNS propagates fast, short timeouts OK
export const HEALTH_CHECK = {
  intervalMs: 2000,
  timeoutMs: 60000,
  fetchTimeoutMs: 5000,
  dnsTimeoutMs: 2000,
};

export const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://abc-tunnel.us";
