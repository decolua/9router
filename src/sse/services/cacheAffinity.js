import crypto from "node:crypto";

const MAX_ENTRIES = 5_000;
const TTL_MS = {
  session: 6 * 60 * 60 * 1_000,
  client: 30 * 60 * 1_000,
  "api-key": 5 * 60 * 1_000,
};

const entries = new Map();

function normalized(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hashParts(parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    const value = String(part);
    hash.update(`${Buffer.byteLength(value, "utf8")}:`);
    hash.update(value);
  }
  return hash.digest("hex");
}

function prune(now) {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
  while (entries.size >= MAX_ENTRIES) {
    entries.delete(entries.keys().next().value);
  }
}

export function createCacheAffinityScope({ provider, model, apiKey, fingerprint, sessionId } = {}) {
  const providerId = normalized(provider);
  const modelId = normalized(model);
  const key = normalized(apiKey);
  if (!providerId || !modelId || !key) return null;

  const client = normalized(fingerprint);
  const session = normalized(sessionId);
  const level = session && client ? "session" : client ? "client" : "api-key";
  const identity = level === "session"
    ? [session, client, key]
    : level === "client"
      ? [client, key]
      : [key];

  return {
    key: hashParts(["9router-cache-affinity-v1", providerId, modelId, level, ...identity]),
    level,
    ttlMs: TTL_MS[level],
  };
}

export function getCacheAffinityPreference(scope, now = Date.now()) {
  if (!scope?.key) return null;
  const entry = entries.get(scope.key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    entries.delete(scope.key);
    return null;
  }
  entries.delete(scope.key);
  entries.set(scope.key, entry);
  return entry.connectionId;
}

export function rememberCacheAffinity(scope, connectionId, now = Date.now()) {
  const id = normalized(connectionId);
  if (!scope?.key || !Number.isFinite(scope.ttlMs) || scope.ttlMs <= 0 || !id) return false;

  const existing = entries.get(scope.key);
  if (existing && existing.expiresAt > now && existing.connectionId === id) {
    entries.delete(scope.key);
    entries.set(scope.key, existing);
    return true;
  }

  if (existing) entries.delete(scope.key);
  prune(now);
  entries.set(scope.key, { connectionId: id, expiresAt: now + scope.ttlMs });
  return true;
}

export function clearCacheAffinity() {
  entries.clear();
}

