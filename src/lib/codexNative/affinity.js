import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { CODEX_NATIVE_CONFIG } from "open-sse/config/codexNative.js";

const AFFINITY_FILE = path.join(DATA_DIR, "codex-native", "affinity.json");
const AFFINITY_SECRET_FILE = path.join(DATA_DIR, "codex-native", "affinity.key");

if (!global.__codexNativeAffinityState) {
  global.__codexNativeAffinityState = {
    entries: new Map(),
    loaded: false,
    persistTimer: null,
    secret: null,
  };
}
const state = global.__codexNativeAffinityState;

function normalize(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 512 ? trimmed : null;
}

function header(headers, name) {
  return normalize(headers?.[name] ?? headers?.[name.toLowerCase()]);
}

function rawSessionIdentity(headers, body) {
  return header(headers, "session-id")
    || header(headers, "thread-id")
    || normalize(body?.prompt_cache_key)
    || null;
}

async function affinitySecret() {
  if (state.secret) return state.secret;
  try {
    state.secret = await fs.readFile(AFFINITY_SECRET_FILE);
  } catch {
    state.secret = crypto.randomBytes(32);
    await fs.mkdir(path.dirname(AFFINITY_SECRET_FILE), { recursive: true });
    const tempPath = `${AFFINITY_SECRET_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, state.secret, { mode: 0o600 });
    try {
      await fs.rename(tempPath, AFFINITY_SECRET_FILE);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      state.secret = await fs.readFile(AFFINITY_SECRET_FILE);
    }
  }
  return state.secret;
}

function cleanup() {
  const now = Date.now();
  for (const [key, entry] of state.entries) {
    if (now - entry.lastUsedAt > CODEX_NATIVE_CONFIG.affinityTtlMs) state.entries.delete(key);
  }
  while (state.entries.size > CODEX_NATIVE_CONFIG.affinityMaxEntries) {
    state.entries.delete(state.entries.keys().next().value);
  }
}

async function ensureLoaded() {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const parsed = JSON.parse(await fs.readFile(AFFINITY_FILE, "utf8"));
    for (const [key, value] of Object.entries(parsed?.entries || {})) {
      if (value?.connectionId && Number.isFinite(value?.lastUsedAt)) {
        state.entries.set(key, value);
      }
    }
    cleanup();
  } catch {
    // First run.
  }
}

function schedulePersist() {
  if (state.persistTimer) return;
  state.persistTimer = setTimeout(async () => {
    state.persistTimer = null;
    cleanup();
    try {
      await fs.mkdir(path.dirname(AFFINITY_FILE), { recursive: true });
      const tempPath = `${AFFINITY_FILE}.${process.pid}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify({
        version: 1,
        entries: Object.fromEntries(state.entries),
      }), { mode: 0o600 });
      await fs.rename(tempPath, AFFINITY_FILE);
    } catch {
      // Affinity persistence is an optimization; routing remains correct in memory.
    }
  }, 100);
  state.persistTimer.unref?.();
}

export async function resolveCodexNativeAffinityKey({ headers, body }) {
  await ensureLoaded();
  const raw = rawSessionIdentity(headers, body);
  if (!raw) return null;
  return crypto.createHmac("sha256", await affinitySecret())
    .update(raw)
    .digest("hex");
}

export async function getCodexNativeAffinity(key) {
  await ensureLoaded();
  cleanup();
  const entry = key ? state.entries.get(key) : null;
  if (!entry) return null;
  entry.lastUsedAt = Date.now();
  state.entries.delete(key);
  state.entries.set(key, entry);
  schedulePersist();
  return { ...entry };
}

export async function bindCodexNativeAffinity(key, connectionId) {
  if (!key || !connectionId) return;
  await ensureLoaded();
  state.entries.delete(key);
  state.entries.set(key, { connectionId, lastUsedAt: Date.now() });
  cleanup();
  schedulePersist();
}

export async function releaseCodexNativeAffinity(key, connectionId) {
  if (!key) return;
  await ensureLoaded();
  const current = state.entries.get(key);
  if (!current || (connectionId && current.connectionId !== connectionId)) return;
  state.entries.delete(key);
  schedulePersist();
}

export async function getCodexNativeAffinityCounts() {
  await ensureLoaded();
  cleanup();
  const counts = new Map();
  for (const entry of state.entries.values()) {
    counts.set(entry.connectionId, (counts.get(entry.connectionId) || 0) + 1);
  }
  return counts;
}
