// Tunnel + Tailscale shared config (all values in ms)
export const HEALTH_CHECK = {
  intervalMs: 2000,
  timeoutMs: 180000,
  fetchTimeoutMs: 5000,
  dnsTimeoutMs: 2000,
};

export const INTERNET_CHECK = {
  host: "1.1.1.1",
  port: 443,
  timeoutMs: 3000,
};

export const RESTART_COOLDOWN_MS = 180000;
export const NETWORK_SETTLE_MS = 2500;
export const WATCHDOG_INTERVAL_MS = 60000;
export const NETWORK_CHECK_INTERVAL_MS = 5000;
