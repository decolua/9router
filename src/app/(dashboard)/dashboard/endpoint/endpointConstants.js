import { WENYAN_LOCALES, CAVEMAN_LEVELS } from "@/shared/constants/compress";

// Re-exported for backwards-compatible imports inside the endpoint page.
export { WENYAN_LOCALES, CAVEMAN_LEVELS };


export const TUNNEL_BENEFITS = [
  { icon: "public", title: "Access Anywhere", desc: "Use your API from any network" },
  { icon: "group", title: "Share Endpoint", desc: "Share URL with team members" },
  { icon: "code", title: "Use in Cursor/Cline", desc: "Connect AI tools remotely" },
  { icon: "lock", title: "Encrypted", desc: "End-to-end TLS via Cloudflare" },
];

export const TUNNEL_PING_INTERVAL_MS = 2000;
export const TUNNEL_PING_MAX_MS = 300000;
export const STATUS_POLL_FAST_MS = 5000;
export const STATUS_POLL_SLOW_MS = 30000;
export const REACHABLE_MISS_THRESHOLD = 5;
export const CLIENT_PING_FAST_MS = 10000;
export const CLIENT_PING_SLOW_MS = 60000;
export const CLIENT_PING_TIMEOUT_MS = 5000;

