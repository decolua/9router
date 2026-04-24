import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir";

const TUNNEL_DIR = path.join(DATA_DIR, "tunnel");
const STATE_FILE = path.join(TUNNEL_DIR, "state.json");
const CLOUDFLARED_PID_FILE = path.join(TUNNEL_DIR, "cloudflared.pid");
const TAILSCALE_PID_FILE = path.join(TUNNEL_DIR, "tailscale.pid");

function ensureDir(): void {
  if (!fs.existsSync(TUNNEL_DIR)) {
    fs.mkdirSync(TUNNEL_DIR, { recursive: true });
  }
}

export interface TunnelState {
  shortId: string;
  machineId: string;
  tunnelUrl: string | null;
}

export function loadState(): TunnelState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch (e) { /* ignore corrupt state */ }
  return null;
}

export function saveState(state: TunnelState): void {
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function clearState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } catch (e) { /* ignore */ }
}

// Cloudflare-specific PID
export function savePid(pid: number): void {
  ensureDir();
  fs.writeFileSync(CLOUDFLARED_PID_FILE, pid.toString());
}

export function loadPid(): number | null {
  try {
    if (fs.existsSync(CLOUDFLARED_PID_FILE)) {
      return parseInt(fs.readFileSync(CLOUDFLARED_PID_FILE, "utf8"));
    }
  } catch (e) { /* ignore */ }
  return null;
}

export function clearPid(): void {
  try {
    if (fs.existsSync(CLOUDFLARED_PID_FILE)) fs.unlinkSync(CLOUDFLARED_PID_FILE);
  } catch (e) { /* ignore */ }
}

// Tailscale-specific PID
export function saveTailscalePid(pid: number): void {
  ensureDir();
  fs.writeFileSync(TAILSCALE_PID_FILE, pid.toString());
}

export function loadTailscalePid(): number | null {
  try {
    if (fs.existsSync(TAILSCALE_PID_FILE)) {
      return parseInt(fs.readFileSync(TAILSCALE_PID_FILE, "utf8"));
    }
  } catch (e) { /* ignore */ }
  return null;
}

export function clearTailscalePid(): void {
  try {
    if (fs.existsSync(TAILSCALE_PID_FILE)) fs.unlinkSync(TAILSCALE_PID_FILE);
  } catch (e) { /* ignore */ }
}

const SHORT_ID_LENGTH = 6;
const SHORT_ID_CHARS = "abcdefghijklmnpqrstuvwxyz23456789";

export function generateShortId(): string {
  let result = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    result += SHORT_ID_CHARS.charAt(Math.floor(Math.random() * SHORT_ID_CHARS.length));
  }
  return result;
}
