import crypto from "crypto";
import { loadState, saveState, clearState } from "./state.js";
import { spawnCloudflared, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler } from "./cloudflared.js";
import { getSettings, updateSettings } from "@/lib/localDb";

const TUNNEL_WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://tunnel.9router.com";
const MACHINE_ID_SALT = "9router-tunnel-salt";
const API_KEY_SECRET = "9router-tunnel-api-key-secret";
const SHORT_ID_LENGTH = 6;
const SHORT_ID_CHARS = "abcdefghijklmnpqrstuvwxyz23456789";
const RECONNECT_DELAYS_MS = [5000, 15000, 30000];

let isReconnecting = false;

function generateShortId() {
  let result = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    result += SHORT_ID_CHARS.charAt(Math.floor(Math.random() * SHORT_ID_CHARS.length));
  }
  return result;
}

function getMachineId() {
  try {
    const { machineIdSync } = require("node-machine-id");
    const raw = machineIdSync();
    return crypto.createHash("sha256").update(raw + MACHINE_ID_SALT).digest("hex").substring(0, 16);
  } catch (e) {
    return crypto.randomUUID().replace(/-/g, "").substring(0, 16);
  }
}

function generateApiKey(machineId) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let keyId = "";
  for (let i = 0; i < 6; i++) {
    keyId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const crc = crypto.createHmac("sha256", API_KEY_SECRET).update(machineId + keyId).digest("hex").slice(0, 8);
  return `sk-${machineId}-${keyId}-${crc}`;
}

async function workerFetch(reqPath, options = {}) {
  const url = `${TUNNEL_WORKER_URL}${reqPath}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  return res.json();
}

export async function enableTunnel() {
  const existing = loadState();
  if (existing && existing.tunnelUrl && isCloudflaredRunning()) {
    return { success: true, tunnelUrl: existing.tunnelUrl, shortId: existing.shortId, alreadyRunning: true };
  }

  killCloudflared();

  const machineId = getMachineId();
  const shortId = existing?.shortId || generateShortId();
  const apiKey = existing?.apiKey || generateApiKey(machineId);

  await workerFetch("/api/session/create", {
    method: "POST",
    body: JSON.stringify({ apiKey, shortId })
  });

  const tunnelResult = await workerFetch("/api/tunnel/create", {
    method: "POST",
    body: JSON.stringify({ apiKey })
  });

  if (tunnelResult.error) {
    throw new Error(tunnelResult.error);
  }

  const { token, hostname } = tunnelResult;

  await spawnCloudflared(token);

  saveState({ shortId, apiKey, tunnelUrl: hostname, machineId });

  await updateSettings({ tunnelEnabled: true, tunnelUrl: hostname });

  // Register exit handler for auto-reconnect on unexpected crash/sleep-wake
  setUnexpectedExitHandler(() => scheduleReconnect(0));

  return { success: true, tunnelUrl: hostname, shortId };
}

async function scheduleReconnect(attempt) {
  if (isReconnecting) return;
  isReconnecting = true;

  const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  console.log(`[Tunnel] Unexpected exit detected, reconnecting in ${delay / 1000}s (attempt ${attempt + 1})...`);

  await new Promise((r) => setTimeout(r, delay));

  try {
    const settings = await getSettings();
    if (!settings.tunnelEnabled) {
      console.log("[Tunnel] Tunnel disabled, skipping reconnect");
      isReconnecting = false;
      return;
    }
    await enableTunnel();
    console.log("[Tunnel] Reconnected successfully");
    isReconnecting = false;
  } catch (err) {
    console.log(`[Tunnel] Reconnect attempt ${attempt + 1} failed:`, err.message);
    isReconnecting = false;
    const nextAttempt = attempt + 1;
    if (nextAttempt < RECONNECT_DELAYS_MS.length) {
      scheduleReconnect(nextAttempt);
    } else {
      console.log("[Tunnel] All reconnect attempts exhausted");
    }
  }
}

export async function disableTunnel() {
  const state = loadState();

  killCloudflared();

  if (state?.apiKey) {
    try {
      await workerFetch("/api/tunnel/delete", {
        method: "DELETE",
        body: JSON.stringify({ apiKey: state.apiKey })
      });
    } catch (e) { /* ignore worker errors on disable */ }
  }

  if (state) {
    saveState({ shortId: state.shortId, apiKey: state.apiKey, machineId: state.machineId, tunnelUrl: null });
  }

  await updateSettings({ tunnelEnabled: false, tunnelUrl: "" });

  return { success: true };
}

export async function getTunnelStatus() {
  const state = loadState();
  const running = isCloudflaredRunning();
  const settings = await getSettings();

  return {
    enabled: settings.tunnelEnabled === true && running,
    tunnelUrl: state?.tunnelUrl || "",
    shortId: state?.shortId || "",
    running
  };
}
