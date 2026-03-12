import fs from "fs";
import path from "path";
import os from "os";

const TUNNEL_DIR = path.join(os.homedir(), ".9router", "tunnel");
const STATE_FILE = path.join(TUNNEL_DIR, "state.json");
const PID_FILE = path.join(TUNNEL_DIR, "cloudflared.pid");

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

export function savePid(pid) {
  ensureDir();
  fs.writeFileSync(PID_FILE, pid.toString());
}

export function loadPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      return parseInt(fs.readFileSync(PID_FILE, "utf8"));
    }
  } catch (e) { /* ignore */ }
  return null;
}

export function clearPid() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch (e) { /* ignore */ }
}
