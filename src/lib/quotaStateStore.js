import { createClient } from "redis";

const REDIS_PREFIX = "9router:quota-state:";
const HOT_STATE_TTL_SECONDS = Number(process.env.REDIS_HOT_STATE_TTL_SECONDS || 86400);
const memoryState = new Map();

const HOT_STATE_KEYS = new Set([
  "lastUsedAt",
  "consecutiveUseCount",
  "testStatus",
  "lastError",
  "lastErrorAt",
  "backoffLevel",
  "rateLimitedUntil",
  "expiresIn",
  "errorCode",
  "lastTested",
  "updatedAt",
]);

let redisClient = null;
let redisConnectPromise = null;
let redisDisabled = false;

function isRedisConfigured() {
  return Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
}

function getProviderRedisKey(providerId) {
  return `${REDIS_PREFIX}${providerId}`;
}

function getProviderMemoryState(providerId) {
  const key = getProviderRedisKey(providerId);
  if (!memoryState.has(key)) {
    memoryState.set(key, new Map());
  }
  return memoryState.get(key);
}

function buildRedisOptions() {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL };
  }

  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = Number(process.env.REDIS_PORT || 6379);
  const database = process.env.REDIS_DB !== undefined ? Number(process.env.REDIS_DB) : 0;
  const username = process.env.REDIS_USERNAME || undefined;
  const password = process.env.REDIS_PASSWORD || undefined;

  return {
    socket: {
      host,
      port,
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 5000),
      keepAlive: true,
      keepAliveInitialDelay: 5000,
      tls: process.env.REDIS_TLS === "true" || process.env.REDIS_TLS === "1",
    },
    database,
    username,
    password,
    name: process.env.REDIS_CLIENT_NAME || "9router",
  };
}

function parseStoredState(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mergeState(base, updates) {
  return { ...(base || {}), ...(updates || {}) };
}

function normalizeConnectionRef(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return { connectionId: entry, providerId: null };
  }
  if (typeof entry === "object") {
    const connectionId = entry.connectionId || entry.id || null;
    const providerId = entry.providerId || entry.provider || null;
    if (!connectionId || !providerId) return null;
    return { connectionId, providerId };
  }
  return null;
}

function hydrateProviderState(providerId, rawState = {}) {
  const providerState = new Map();
  for (const [connectionId, raw] of Object.entries(rawState || {})) {
    const parsed = parseStoredState(raw);
    if (parsed) {
      providerState.set(connectionId, parsed);
    }
  }
  memoryState.set(getProviderRedisKey(providerId), providerState);
  return providerState;
}

async function getRedisClient() {
  if (!isRedisConfigured() || redisDisabled) return null;
  if (redisClient?.isReady) return redisClient;

  if (!redisConnectPromise) {
    redisConnectPromise = (async () => {
      try {
        const client = createClient(buildRedisOptions());
        client.on("error", (err) => {
          console.warn(`[Redis] Client error: ${err?.message || err}`);
        });
        await client.connect();
        redisClient = client;
        return client;
      } catch (error) {
        console.warn(`[Redis] Disabled: ${error?.message || error}`);
        redisDisabled = true;
        redisClient = null;
        return null;
      } finally {
        redisConnectPromise = null;
      }
    })();
  }

  return redisConnectPromise;
}

export function isHotStateKey(key) {
  return HOT_STATE_KEYS.has(key) || key.startsWith("modelLock_");
}

export function extractHotState(updates = {}) {
  const hotState = {};
  for (const [key, value] of Object.entries(updates || {})) {
    if (isHotStateKey(key)) hotState[key] = value;
  }
  return hotState;
}

export function isHotOnlyUpdate(updates = {}) {
  const keys = Object.keys(updates || {});
  if (keys.length === 0) return false;
  return keys.every((key) => isHotStateKey(key));
}

export async function getConnectionHotState(connectionId, providerId) {
  if (!connectionId || !providerId) return null;

  const providerState = await getProviderHotState(providerId);
  if (!providerState) return null;

  if (providerState.has(connectionId)) {
    return providerState.get(connectionId);
  }

  return null;
}

async function getProviderHotState(providerId) {
  if (!providerId) return null;

  const key = getProviderRedisKey(providerId);
  if (memoryState.has(key)) {
    return memoryState.get(key);
  }

  const client = await getRedisClient();
  if (!client) return null;

  try {
    const rawState = await client.hGetAll(key);
    return hydrateProviderState(providerId, rawState);
  } catch (error) {
    console.warn(`[Redis] Failed to read hot state for provider ${providerId}: ${error?.message || error}`);
  }

  return null;
}

export async function getConnectionHotStates(connectionRefs = []) {
  const refs = [...new Map((connectionRefs || [])
    .map(normalizeConnectionRef)
    .filter(Boolean)
    .map((ref) => [`${ref.providerId}:${ref.connectionId}`, ref]))
  .values()];
  const result = new Map();

  if (refs.length === 0) return result;

  const refsByProvider = new Map();
  for (const ref of refs) {
    if (!refsByProvider.has(ref.providerId)) {
      refsByProvider.set(ref.providerId, []);
    }
    refsByProvider.get(ref.providerId).push(ref.connectionId);
  }

  for (const [providerId, connectionIds] of refsByProvider.entries()) {
    const providerState = await getProviderHotState(providerId);
    if (!providerState) continue;

    for (const connectionId of connectionIds) {
      if (providerState.has(connectionId)) {
        result.set(connectionId, providerState.get(connectionId));
      }
    }
  }

  return result;
}

export async function setConnectionHotState(connectionId, providerId, updates = {}) {
  if (!connectionId || !providerId || !updates || typeof updates !== "object") {
    return { storedInRedis: false, state: null };
  }

  const key = getProviderRedisKey(providerId);
  const providerState = (await getProviderHotState(providerId)) || getProviderMemoryState(providerId);
  const current = providerState.get(connectionId) || {};
  const next = mergeState(current, updates);
  providerState.set(connectionId, next);
  memoryState.set(key, providerState);

  const client = await getRedisClient();
  if (!client) {
    return { storedInRedis: false, state: next };
  }

  try {
    await client.hSet(key, connectionId, JSON.stringify(next));
    if (Number.isFinite(HOT_STATE_TTL_SECONDS) && HOT_STATE_TTL_SECONDS > 0) {
      await client.expire(key, HOT_STATE_TTL_SECONDS);
    }
    return { storedInRedis: true, state: next };
  } catch (error) {
    console.warn(`[Redis] Failed to store hot state for ${providerId}/${connectionId}: ${error?.message || error}`);
    return { storedInRedis: false, state: next };
  }
}

export async function isRedisHotStateReady() {
  const client = await getRedisClient();
  return Boolean(client?.isReady);
}

export async function deleteConnectionHotState(connectionId, providerId) {
  if (!connectionId || !providerId) return;

  const key = getProviderRedisKey(providerId);
  const providerState = memoryState.get(key);
  if (providerState) {
    providerState.delete(connectionId);
    if (providerState.size === 0) {
      memoryState.delete(key);
    }
  }

  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.hDel(key, connectionId);
    const remaining = await client.hLen(key);
    if (remaining === 0) {
      await client.del(key);
    } else if (Number.isFinite(HOT_STATE_TTL_SECONDS) && HOT_STATE_TTL_SECONDS > 0) {
      await client.expire(key, HOT_STATE_TTL_SECONDS);
    }
  } catch (error) {
    console.warn(`[Redis] Failed to delete hot state for ${providerId}/${connectionId}: ${error?.message || error}`);
  }
}

export async function mergeConnectionsWithHotState(connections = []) {
  if (!Array.isArray(connections) || connections.length === 0) return connections;

  const hotStates = await getConnectionHotStates(connections.map((connection) => ({ id: connection.id, provider: connection.provider })));
  return connections.map((connection) => {
    const hotState = hotStates.get(connection.id);
    return hotState ? { ...connection, ...hotState } : connection;
  });
}
