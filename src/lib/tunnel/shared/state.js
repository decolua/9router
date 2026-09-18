import fs from "fs";
import path from "path";
import { randomInt } from "crypto";
import { DATA_DIR } from "@/lib/dataDir.js";

const TUNNEL_DIR = path.join(DATA_DIR, "tunnel");
const STATE_FILE = path.join(TUNNEL_DIR, "state.json");

const SHORT_ID_LENGTH = 6;
const SHORT_ID_CHARS = "abcdefghijklmnpqrstuvwxyz23456789";

export function ensureTunnelDir() {
  if (!fs.existsSync(TUNNEL_DIR)) fs.mkdirSync(TUNNEL_DIR, { recursive: true });
}

export function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch { /* ignore corrupt state */ }
  return null;
}

export function saveState(state) {
  ensureTunnelDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function clearState() {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } catch { /* ignore */ }
}

/**
 * The public tunnel subdomain (`https://r<shortId>.abc-tunnel.us`) is what stands
 * between the open internet and this machine's dashboard and /v1 gateway, so it is
 * a secret, not a display name.
 *
 * `Math.random()` is not a CSPRNG: V8 seeds a xorshift128+ generator whose internal
 * state can be recovered from a small number of observed outputs, after which every
 * other value it produces in the same process is predictable — including ids handed
 * out elsewhere. `crypto.randomInt` draws from the OS CSPRNG and is rejection-sampled,
 * so it is also free of the modulo bias a `% length` mapping would introduce.
 */
export function generateShortId() {
  let result = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    result += SHORT_ID_CHARS.charAt(randomInt(0, SHORT_ID_CHARS.length));
  }
  return result;
}

export { TUNNEL_DIR };
