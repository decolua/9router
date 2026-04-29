import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir.js";

const TUNNEL_DIR = path.join(DATA_DIR, "tunnel");
const STATE_FILE = path.join(TUNNEL_DIR, "state.json");
const CLOUDFLARED_PID_FILE = path.join(TUNNEL_DIR, "cloudflared.pid");
const TAILSCALE_PID_FILE = path.join(TUNNEL_DIR, "tailscale.pid");

function ensureDir() {
  if (!fs.existsSync(TUNNEL_DIR)) {
    fs.mkdirSync(TUNNEL_DIR, { recursive: true });
  }
}

export function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch (e) { /* ignore corrupt state */ }
  return null;
}

export function saveState(state) {
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function clearState() {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } catch (e) { /* ignore */ }
}

// Cloudflare-specific PID
export function savePid(pid) {
  ensureDir();
  fs.writeFileSync(CLOUDFLARED_PID_FILE, pid.toString());
}

export function loadPid() {
  try {
    if (fs.existsSync(CLOUDFLARED_PID_FILE)) {
      return parseInt(fs.readFileSync(CLOUDFLARED_PID_FILE, "utf8"));
    }
  } catch (e) { /* ignore */ }
  return null;
}

export function clearPid() {
  try {
    if (fs.existsSync(CLOUDFLARED_PID_FILE)) fs.unlinkSync(CLOUDFLARED_PID_FILE);
  } catch (e) { /* ignore */ }
}

// Tailscale-specific PID
export function saveTailscalePid(pid) {
  ensureDir();
  fs.writeFileSync(TAILSCALE_PID_FILE, pid.toString());
}

export function loadTailscalePid() {
  try {
    if (fs.existsSync(TAILSCALE_PID_FILE)) {
      return parseInt(fs.readFileSync(TAILSCALE_PID_FILE, "utf8"));
    }
  } catch (e) { /* ignore */ }
  return null;
}

export function clearTailscalePid() {
  try {
    if (fs.existsSync(TAILSCALE_PID_FILE)) fs.unlinkSync(TAILSCALE_PID_FILE);
  } catch (e) { /* ignore */ }
}

const SHORT_ID_LENGTH = 6;
const SHORT_ID_CHARS = "abcdefghijklmnpqrstuvwxyz23456789";

export function generateShortId() {
  let result = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    result += SHORT_ID_CHARS.charAt(Math.floor(Math.random() * SHORT_ID_CHARS.length));
  }
  return result;
}
