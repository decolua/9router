// One-time console setup token for first-run bootstrap.
//
// When the server starts with nothing configured it mints a random token,
// writes it to DATA_DIR (0600) and prints it to the console. Whoever can read
// the host console owns the instance — a stranger who reaches the port first
// cannot claim it.
//
// Portainer-style timeout: the token is only valid for SETUP_WINDOW_MS after it
// was issued. Past that the setup endpoint refuses until the server restarts,
// which mints a fresh token and reopens the window.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";

export const SETUP_WINDOW_MS = 5 * 60 * 1000;

const TOKEN_FILE = path.join(DATA_DIR, "setup-token.json");

function readTokenFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    if (!parsed?.token || typeof parsed.token !== "string") return null;
    const createdAt = Number(parsed.createdAt) || 0;
    return { token: parsed.token, createdAt };
  } catch {
    return null;
  }
}

// Tracks whether this process already minted a token (survives HMR). It is
// what makes "restart to get a new token" true — a stale file from an earlier
// run is replaced on the first mint of a new process — while guaranteeing no
// request can mint a second token and silently invalidate the printed one.
const g = (globalThis.__setupTokenMint ??= { minted: false });

export function hasMintedThisProcess() {
  return g.minted;
}

export function issueSetupToken() {
  const token = crypto.randomBytes(24).toString("base64url");
  const payload = { token, createdAt: Date.now() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(payload), { mode: 0o600 });
  g.minted = true;
  return token;
}

export function clearSetupToken() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {
    /* already gone */
  }
}

// Test-only: forget that this process minted a token.
export function __resetMintStateForTests() {
  g.minted = false;
}

export function getSetupTokenState() {
  const entry = readTokenFile();
  if (!entry) return { present: false, expired: true, expiresInSec: 0 };
  const remaining = entry.createdAt + SETUP_WINDOW_MS - Date.now();
  return {
    present: true,
    expired: remaining <= 0,
    expiresInSec: Math.max(0, Math.ceil(remaining / 1000)),
  };
}

// Constant-time comparison; also enforces the setup window.
export function verifySetupToken(candidate) {
  if (typeof candidate !== "string" || !candidate) return { ok: false, reason: "invalid" };
  const entry = readTokenFile();
  if (!entry) return { ok: false, reason: "missing" };
  if (entry.createdAt + SETUP_WINDOW_MS - Date.now() <= 0) return { ok: false, reason: "expired" };

  const a = Buffer.from(candidate);
  const b = Buffer.from(entry.token);
  if (a.length !== b.length) return { ok: false, reason: "invalid" };
  return crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "invalid" };
}

export function printSetupBanner(token, { reason = "first run" } = {}) {
  const minutes = Math.round(SETUP_WINDOW_MS / 60000);
  const line = "─".repeat(64);
  console.log(
    `\n${line}\n` +
    `  10router setup required (${reason})\n` +
    `  Open the dashboard at /setup and paste this token:\n\n` +
    `      ${token}\n\n` +
    `  Valid for ${minutes} minutes. Restart the server to get a new one.\n` +
    `${line}\n`
  );
}
