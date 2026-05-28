import { machineId } from "node-machine-id";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";

const MACHINE_ID_FILE = path.join(DATA_DIR, "machine-id");
const AUTH_DIR = path.join(DATA_DIR, "auth");
const CLI_SECRET_FILE = path.join(AUTH_DIR, "cli-secret");
const CLI_AUTH_SALT = "9r-cli-auth";
let cachedRawId = null;
let cachedCliSecret = null;

// Persist raw machine ID to file → guarantees CLI/server/middleware see same value
// even when machineId fails or returns inconsistent values across runtimes.
async function loadRawMachineId() {
  if (cachedRawId) return cachedRawId;
  try {
    cachedRawId = (await fs.readFile(MACHINE_ID_FILE, "utf8")).trim();
    if (cachedRawId) return cachedRawId;
  } catch {}
  try {
    cachedRawId = await machineId();
  } catch {
    cachedRawId = crypto.randomUUID();
  }
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(MACHINE_ID_FILE, cachedRawId, { mode: 0o600 });
  } catch {}
  return cachedRawId;
}

// Random secret persisted on first run → unpredictable CLI token even when machineId leaks.
async function loadCliSecret() {
  if (cachedCliSecret) return cachedCliSecret;
  try {
    cachedCliSecret = (await fs.readFile(CLI_SECRET_FILE, "utf8")).trim();
    if (cachedCliSecret) return cachedCliSecret;
  } catch {}
  cachedCliSecret = crypto.randomBytes(32).toString("hex");
  try {
    await fs.mkdir(AUTH_DIR, { recursive: true });
    await fs.writeFile(CLI_SECRET_FILE, cachedCliSecret, { mode: 0o600 });
  } catch {}
  return cachedCliSecret;
}

export async function getConsistentMachineId(salt = null) {
  const saltValue =
    salt || process.env.MACHINE_ID_SALT || "endpoint-proxy-salt";
  const raw = await loadRawMachineId();
  const extra = saltValue === CLI_AUTH_SALT ? await loadCliSecret() : "";
  return crypto
    .createHash("sha256")
    .update(raw + saltValue + extra)
    .digest("hex")
    .substring(0, 16);
}

export async function getRawMachineId() {
  return loadRawMachineId();
}

/**
 * Check if we're running in browser or server environment
 * @returns {boolean} True if in browser, false if in server
 */
export function isBrowser() {
  return typeof window !== "undefined";
}
