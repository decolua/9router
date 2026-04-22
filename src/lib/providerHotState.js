import { createClient } from "redis";

const REDIS_PREFIX = "9router:provider-hot-state:";
const HOT_STATE_TTL_SECONDS = Number(process.env.REDIS_HOT_STATE_TTL_SECONDS || 86400);
const PROVIDER_META_FIELD = "__provider_meta__";
const CONNECTION_FIELD_PREFIX = "__conn__:";
const CONNECTION_FIELD_SEPARATOR = ":";
const providerStateCache = new Map();

const HOT_STATE_KEYS = new Set([
  "routingStatus",
  "healthStatus",
  "quotaState",
  "authState",
  "reasonCode",
  "reasonDetail",
  "nextRetryAt",
  "resetAt",
  "lastCheckedAt",
  "usageSnapshot",
  "version",
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

function parseStoredValue(raw) {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function encodeRedisFieldPart(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeRedisFieldPart(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!decoded.length) return null;
    return Buffer.from(decoded, "utf8").toString("base64") === value ? decoded : null;
  } catch {
    return null;
  }
}

function getRedisConnectionField(connectionId, stateKey) {
  if (!connectionId || !stateKey) return null;

  const encodedConnectionId = encodeRedisFieldPart(connectionId);
  const encodedStateKey = encodeRedisFieldPart(stateKey);
  if (!encodedConnectionId || !encodedStateKey) return null;

  return `${CONNECTION_FIELD_PREFIX}${encodedConnectionId}${CONNECTION_FIELD_SEPARATOR}${encodedStateKey}`;
}

function parseRedisConnectionField(field) {
  if (!field || !field.startsWith(CONNECTION_FIELD_PREFIX)) return null;

  const encoded = field.slice(CONNECTION_FIELD_PREFIX.length);
  const separatorIndex = encoded.indexOf(CONNECTION_FIELD_SEPARATOR);
  if (separatorIndex === -1) return null;

  const encodedConnectionId = encoded.slice(0, separatorIndex);
  const encodedStateKey = encoded.slice(separatorIndex + 1);

  const decodedConnectionId = decodeRedisFieldPart(encodedConnectionId);
  const decodedStateKey = decodeRedisFieldPart(encodedStateKey);

  if (decodedConnectionId && decodedStateKey) {
    return {
      connectionId: decodedConnectionId,
      stateKey: decodedStateKey,
    };
  }

  try {
    return {
      connectionId: decodeURIComponent(encodedConnectionId),
      stateKey: decodeURIComponent(encodedStateKey),
    };
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
    return { connectionId: entry, providerId: null, connection: null };
  }
  if (typeof entry === "object") {
    const connectionId = entry.connectionId || entry.id || null;
    const providerId = entry.providerId || entry.provider || null;
    if (!connectionId || !providerId) return null;
    return { connectionId, providerId, connection: entry };
  }
  return null;
}

function getProviderScopedConnectionKey(providerId, connectionId) {
  if (!providerId || !connectionId) return null;
  return `${providerId}:${connectionId}`;
}

function createEmptyProviderState() {
  return {
    connections: new Map(),
    eligibleConnectionIds: null,
    retryAt: null,
    updatedAt: null,
  };
}

function isFutureTimestamp(value) {
  return Boolean(value) && Number.isFinite(new Date(value).getTime()) && new Date(value).getTime() > Date.now();
}

function isAccountWideModelLockKey(key) {
  return key === "modelLock___all";
}

function getConnectionRetryAt(state = {}) {
  const timestamps = [];

  if (isFutureTimestamp(state.nextRetryAt)) {
    timestamps.push(state.nextRetryAt);
  }

  if (isFutureTimestamp(state.rateLimitedUntil)) {
    timestamps.push(state.rateLimitedUntil);
  }

  for (const [key, value] of Object.entries(state || {})) {
    if (isAccountWideModelLockKey(key) && isFutureTimestamp(value)) {
      timestamps.push(value);
    }
  }

  if (timestamps.length === 0) return null;
  return timestamps.sort()[0];
}

function isConnectionEligible(state = {}) {
  const authState = state?.authState || null;
  if (authState === "expired" || authState === "invalid" || authState === "revoked") {
    return false;
  }

  const healthStatus = state?.healthStatus || null;
  if (["error", "failed", "unhealthy", "down"].includes(healthStatus)) {
    return false;
  }

  const quotaState = state?.quotaState || null;
  if (["exhausted", "cooldown", "blocked"].includes(quotaState)) {
    return false;
  }

  const routingStatus = state?.routingStatus || null;
  if (["blocked_auth", "blocked_health", "blocked_quota", "cooldown", "disabled"].includes(routingStatus)) {
    return false;
  }

  const testStatus = state?.testStatus || null;
  if (testStatus === "unavailable" || testStatus === "error" || testStatus === "expired") {
    return false;
  }
  return !getConnectionRetryAt(state);
}

function isFallbackEligibleConnection(state = {}) {
  const testStatus = state?.testStatus || null;
  const hasLegacyEligibleStatus = testStatus === "active"
    || testStatus === "success"
    || testStatus === "unknown";

  if (!hasLegacyEligibleStatus) return false;
  return isConnectionEligible(state);
}

function recalculateProviderIndexes(providerState) {
  const eligibleConnectionIds = new Set();
  const retryCandidates = [];

  for (const [connectionId, connectionState] of providerState.connections.entries()) {
    const retryAt = getConnectionRetryAt(connectionState);
    if (isConnectionEligible(connectionState)) {
      eligibleConnectionIds.add(connectionId);
    } else if (retryAt) {
      retryCandidates.push(retryAt);
    }
  }

  providerState.eligibleConnectionIds = eligibleConnectionIds;
  providerState.retryAt = retryCandidates.length > 0 ? retryCandidates.sort()[0] : null;
  providerState.updatedAt = new Date().toISOString();
  return providerState;
}

function serializeProviderMeta(providerState) {
  return JSON.stringify({
    eligibleConnectionIds: providerState.eligibleConnectionIds ? [...providerState.eligibleConnectionIds] : null,
    retryAt: providerState.retryAt || null,
    updatedAt: providerState.updatedAt || null,
  });
}

function hydrateProviderState(providerId, rawState = {}) {
  const providerState = createEmptyProviderState();
  const legacyConnectionStates = new Map();

  for (const [field, raw] of Object.entries(rawState || {})) {
    if (field === PROVIDER_META_FIELD) continue;

    const parsedField = parseRedisConnectionField(field);
    if (parsedField) {
      const value = parseStoredValue(raw);
      if (value !== undefined) {
        const connectionState = providerState.connections.get(parsedField.connectionId) || {};
        connectionState[parsedField.stateKey] = value;
        providerState.connections.set(parsedField.connectionId, connectionState);
      }
      continue;
    }

    const parsed = parseStoredState(raw);
    if (parsed) {
      legacyConnectionStates.set(field, parsed);
    }
  }

  for (const [connectionId, legacyState] of legacyConnectionStates.entries()) {
    const currentState = providerState.connections.get(connectionId) || {};
    providerState.connections.set(connectionId, {
      ...legacyState,
      ...currentState,
    });
  }

  recalculateProviderIndexes(providerState);

  providerStateCache.set(providerId, providerState);
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

async function persistProviderState(providerId, providerState) {
  const client = await getRedisClient();
  if (!client) return false;

  const key = getProviderRedisKey(providerId);
  const payload = {};

  for (const [connectionId, connectionState] of providerState.connections.entries()) {
    payload[connectionId] = JSON.stringify(connectionState);
  }
  payload[PROVIDER_META_FIELD] = serializeProviderMeta(providerState);

  try {
    await client.del(key);
    if (Object.keys(payload).length > 0) {
      await client.hSet(key, payload);
      if (Number.isFinite(HOT_STATE_TTL_SECONDS) && HOT_STATE_TTL_SECONDS > 0) {
        await client.expire(key, HOT_STATE_TTL_SECONDS);
      }
    }
    return true;
  } catch (error) {
    console.warn(`[Redis] Failed to store hot state for provider ${providerId}: ${error?.message || error}`);
    return false;
  }
}

async function persistConnectionField(providerId, connectionId, updates = {}) {
  const client = await getRedisClient();
  if (!client) return { storedInRedis: false, providerState: null };

  const key = getProviderRedisKey(providerId);

  const buildPersistPlan = (rawState = {}) => {
    const legacyState = parseStoredState(rawState?.[connectionId]);
    const hasLegacyState = Boolean(legacyState);

    const payload = {};
    const fieldsToPersist = hasLegacyState
      ? (() => {
          const mergedState = { ...legacyState };

          for (const [field, raw] of Object.entries(rawState || {})) {
            const parsedField = parseRedisConnectionField(field);
            if (parsedField?.connectionId === connectionId) {
              const parsedValue = parseStoredValue(raw);
              if (parsedValue !== undefined) {
                mergedState[parsedField.stateKey] = parsedValue;
              }
            }
          }

          return mergeState(mergedState, updates);
        })()
      : updates;

    for (const [stateKey, value] of Object.entries(fieldsToPersist || {})) {
      const redisField = getRedisConnectionField(connectionId, stateKey);
      if (redisField) {
        payload[redisField] = JSON.stringify(value);
      }
    }

    const nextRawState = { ...(rawState || {}) };
    if (Object.keys(payload).length > 0) {
      Object.assign(nextRawState, payload);
    }
    if (hasLegacyState) {
      delete nextRawState[connectionId];
    }

    return {
      hasLegacyState,
      payload,
      nextRawState,
    };
  };

  try {
    if (typeof client.watch === "function" && typeof client.multi === "function") {
      const maxAttempts = 5;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await client.watch(key);

        try {
          const currentRawState = await client.hGetAll(key);
          const { hasLegacyState, payload, nextRawState } = buildPersistPlan(currentRawState);

          if (!nextRawState || Object.keys(nextRawState).length === 0) {
            providerStateCache.delete(providerId);
            return { storedInRedis: true, providerState: null };
          }

          const providerState = hydrateProviderState(providerId, nextRawState);
          const multi = client.multi();

          if (Object.keys(payload).length > 0) {
            multi.hSet(key, payload);
          }

          if (hasLegacyState) {
            multi.hDel(key, connectionId);
          }

          multi.hSet(key, {
            [PROVIDER_META_FIELD]: serializeProviderMeta(providerState),
          });

          if (Number.isFinite(HOT_STATE_TTL_SECONDS) && HOT_STATE_TTL_SECONDS > 0) {
            multi.expire(key, HOT_STATE_TTL_SECONDS);
          }

          const execResult = await multi.exec();
          if (execResult) {
            return { storedInRedis: true, providerState };
          }
        } finally {
          if (typeof client.unwatch === "function") {
            await client.unwatch();
          }
        }
      }

      throw new Error(`Concurrent hot-state migration retry limit exceeded for ${providerId}/${connectionId}`);
    }

    const currentRawState = await client.hGetAll(key);
    const { hasLegacyState, payload, nextRawState } = buildPersistPlan(currentRawState);

    if (Object.keys(payload).length > 0) {
      await client.hSet(key, payload);
    }

    if (hasLegacyState) {
      await client.hDel(key, connectionId);
    }

    if (!nextRawState || Object.keys(nextRawState).length === 0) {
      providerStateCache.delete(providerId);
      return { storedInRedis: true, providerState: null };
    }

    const rawState = await client.hGetAll(key);
    const providerState = hydrateProviderState(providerId, rawState);

    await client.hSet(key, {
      [PROVIDER_META_FIELD]: serializeProviderMeta(providerState),
    });

    if (Number.isFinite(HOT_STATE_TTL_SECONDS) && HOT_STATE_TTL_SECONDS > 0) {
      await client.expire(key, HOT_STATE_TTL_SECONDS);
    }

    return { storedInRedis: true, providerState };
  } catch (error) {
    console.warn(`[Redis] Failed to store hot state for provider ${providerId}: ${error?.message || error}`);
    return { storedInRedis: false, providerState: null };
  }
}

async function deleteConnectionField(providerId, connectionId) {
  const client = await getRedisClient();
  if (!client) return { storedInRedis: false, providerState: null };

  const key = getProviderRedisKey(providerId);

  try {
    const rawState = await client.hGetAll(key);
    const fieldsToDelete = Object.keys(rawState || {}).filter((field) => {
      if (field === connectionId) return true;
      const parsedField = parseRedisConnectionField(field);
      return parsedField?.connectionId === connectionId;
    });

    for (const field of fieldsToDelete) {
      await client.hDel(key, field);
    }

    const nextRawState = await client.hGetAll(key);
    const remainingFields = Object.keys(nextRawState || {}).filter((field) => field !== PROVIDER_META_FIELD);

    if (remainingFields.length === 0) {
      await client.del(key);
      providerStateCache.delete(providerId);
      return { storedInRedis: true, providerState: null };
    }

    const providerState = hydrateProviderState(providerId, nextRawState);

    await client.hSet(key, {
      [PROVIDER_META_FIELD]: serializeProviderMeta(providerState),
    });

    if (Number.isFinite(HOT_STATE_TTL_SECONDS) && HOT_STATE_TTL_SECONDS > 0) {
      await client.expire(key, HOT_STATE_TTL_SECONDS);
    }

    return { storedInRedis: true, providerState };
  } catch (error) {
    console.warn(`[Redis] Failed to delete hot state for ${providerId}/${connectionId}: ${error?.message || error}`);
    return { storedInRedis: false, providerState: null };
  }
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

export async function getProviderHotState(providerId) {
  if (!providerId) return null;
  if (providerStateCache.has(providerId) && !isRedisConfigured()) {
    return providerStateCache.get(providerId);
  }

  const client = await getRedisClient();
  if (!client) {
    return providerStateCache.get(providerId) || null;
  }

  try {
    const rawState = await client.hGetAll(getProviderRedisKey(providerId));
    if (!rawState || Object.keys(rawState).length === 0) {
      providerStateCache.delete(providerId);
      return null;
    }
    return hydrateProviderState(providerId, rawState);
  } catch (error) {
    console.warn(`[Redis] Failed to read hot state for provider ${providerId}: ${error?.message || error}`);
    return providerStateCache.get(providerId) || null;
  }
}

export async function getEligibleConnectionIds(providerId) {
  if (!providerId) return null;
  const providerState = await getProviderHotState(providerId);
  if (!providerState?.eligibleConnectionIds) return null;
  return [...providerState.eligibleConnectionIds];
}

export async function getEligibleConnections(providerId, connections = []) {
  if (!providerId || !Array.isArray(connections) || connections.length === 0) return [];

  const providerState = await getProviderHotState(providerId);
  if (!providerState) return null;

  const eligibleConnectionIds = providerState.eligibleConnectionIds;
  if (!(eligibleConnectionIds instanceof Set)) return null;

  return connections.filter((connection) => {
    if (!connection?.id) return false;
    if (eligibleConnectionIds.has(connection.id)) return true;
    if (providerState.connections.has(connection.id)) return false;

    return isFallbackEligibleConnection(connection);
  });
}

export function projectProviderHotState(connection = {}, providerState = null) {
  if (!connection || typeof connection !== "object") return connection;
  if (!providerState) return connection;

  const connectionHotState = providerState.connections.get(connection.id) || null;
  const projected = connectionHotState ? { ...connection, ...connectionHotState } : { ...connection };
  const eligibleSet = providerState.eligibleConnectionIds;

  if (connectionHotState && eligibleSet instanceof Set && !eligibleSet.has(connection.id)) {
    if (!projected.rateLimitedUntil && providerState.retryAt) {
      projected.rateLimitedUntil = providerState.retryAt;
    }

    const legacyProjection = projectLegacyConnectionState({
      ...projected,
      testStatus: connectionHotState?.testStatus,
    });

    Object.assign(projected, legacyProjection);

    if (!projected.testStatus || projected.testStatus === "active" || projected.testStatus === "success" || projected.testStatus === "unknown") {
      projected.testStatus = "unavailable";
    }
  }

  return projected;
}

export async function getConnectionHotState(connectionId, providerId) {
  if (!connectionId || !providerId) return null;
  const providerState = await getProviderHotState(providerId);
  if (!providerState) return null;
  return projectProviderHotState({ id: connectionId }, providerState);
}

export async function getConnectionHotStates(connectionRefs = []) {
  const refs = [...new Map((connectionRefs || [])
    .map(normalizeConnectionRef)
    .filter(Boolean)
    .map((ref) => [`${ref.providerId}:${ref.connectionId}`, ref]))
    .values()];
  const result = new Map();

  if (refs.length === 0) return result;

  const connectionIdProviderCounts = new Map();
  const refsByProvider = new Map();
  for (const ref of refs) {
    connectionIdProviderCounts.set(ref.connectionId, (connectionIdProviderCounts.get(ref.connectionId) || 0) + 1);

    if (!refsByProvider.has(ref.providerId)) {
      refsByProvider.set(ref.providerId, []);
    }
    refsByProvider.get(ref.providerId).push(ref);
  }

  for (const [providerId, providerRefs] of refsByProvider.entries()) {
    const providerState = await getProviderHotState(providerId);
    if (!providerState) continue;

    for (const ref of providerRefs) {
      const projected = projectProviderHotState(ref.connection || { id: ref.connectionId }, providerState);
      const scopedKey = getProviderScopedConnectionKey(ref.providerId, ref.connectionId);

      result.set(scopedKey, projected);

      if (connectionIdProviderCounts.get(ref.connectionId) === 1 && !result.has(ref.connectionId)) {
        result.set(ref.connectionId, projected);
      }
    }
  }

  return result;
}

export async function setConnectionHotState(connectionId, providerId, updates = {}) {
  if (!connectionId || !providerId || !updates || typeof updates !== "object") {
    return { storedInRedis: false, state: null };
  }

  const providerState = (await getProviderHotState(providerId)) || createEmptyProviderState();
  const current = providerState.connections.get(connectionId) || {};
  const next = mergeState(current, updates);

  providerState.connections.set(connectionId, next);
  recalculateProviderIndexes(providerState);
  providerStateCache.set(providerId, providerState);

  let storedInRedis = false;
  const client = await getRedisClient();
  if (client) {
    const persisted = await persistConnectionField(providerId, connectionId, updates);
    storedInRedis = persisted.storedInRedis;
  } else {
    storedInRedis = await persistProviderState(providerId, providerState);
  }

  const latestProviderState = providerStateCache.get(providerId) || providerState;
  return {
    storedInRedis,
    state: next,
    providerState: {
      eligibleConnectionIds: latestProviderState.eligibleConnectionIds ? [...latestProviderState.eligibleConnectionIds] : null,
      retryAt: latestProviderState.retryAt,
      updatedAt: latestProviderState.updatedAt,
    },
  };
}

export async function writeConnectionHotState({ connectionId, provider, patch = {} } = {}) {
  const result = await setConnectionHotState(connectionId, provider, patch);
  return result?.state || null;
}

export function projectLegacyConnectionState(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      testStatus: "unknown",
      lastError: null,
      lastErrorType: null,
      lastErrorAt: null,
      rateLimitedUntil: null,
      errorCode: null,
      lastTested: null,
    };
  }

  const explicitTestStatus = snapshot.testStatus;
  const routingStatus = snapshot.routingStatus || null;
  let testStatus = explicitTestStatus || "unknown";

  if (!explicitTestStatus) {
    if (routingStatus === "eligible") testStatus = "active";
    else if (routingStatus === "blocked_quota" || routingStatus === "cooldown") testStatus = "unavailable";
    else if (routingStatus === "blocked_auth") testStatus = "expired";
    else if (routingStatus === "blocked_health") testStatus = "error";
  }

  let lastError = snapshot.lastError ?? null;
  let lastErrorType = snapshot.lastErrorType ?? null;

  if (testStatus === "active" || testStatus === "success") {
    lastError = null;
    lastErrorType = null;
  } else {
    if (lastError == null && snapshot.reasonDetail) {
      lastError = snapshot.reasonDetail;
    }
    if (lastErrorType == null && snapshot.reasonCode && snapshot.reasonCode !== "unknown") {
      lastErrorType = snapshot.reasonCode;
    }
    if (lastError == null && routingStatus === "blocked_quota") {
      lastError = "Quota exhausted";
    }
    if (lastError == null && routingStatus === "blocked_auth") {
      lastError = "Authentication expired";
    }
    if (lastError == null && routingStatus === "blocked_health") {
      lastError = "Provider unhealthy";
    }
  }

  return {
    testStatus,
    lastError,
    lastErrorType,
    lastErrorAt: snapshot.lastErrorAt ?? (lastError ? snapshot.lastCheckedAt || null : null),
    rateLimitedUntil: snapshot.rateLimitedUntil ?? snapshot.nextRetryAt ?? snapshot.resetAt ?? null,
    errorCode: snapshot.errorCode ?? (snapshot.reasonCode && snapshot.reasonCode !== "unknown" ? snapshot.reasonCode : null),
    lastTested: snapshot.lastTested ?? snapshot.lastCheckedAt ?? null,
  };
}

export async function isRedisHotStateReady() {
  const client = await getRedisClient();
  return Boolean(client?.isReady);
}

export async function deleteConnectionHotState(connectionId, providerId) {
  if (!connectionId || !providerId) return;

  const providerState = (await getProviderHotState(providerId)) || providerStateCache.get(providerId);
  if (!providerState) return;

  providerState.connections.delete(connectionId);
  if (providerState.connections.size === 0) {
    providerStateCache.delete(providerId);
  } else {
    recalculateProviderIndexes(providerState);
    providerStateCache.set(providerId, providerState);
  }

  const client = await getRedisClient();
  if (!client) return;

  await deleteConnectionField(providerId, connectionId);
}

export async function clearProviderHotState(providerId) {
  if (!providerId) return false;

  providerStateCache.delete(providerId);

  const client = await getRedisClient();
  if (!client) return false;

  try {
    await client.del(getProviderRedisKey(providerId));
    return true;
  } catch (error) {
    console.warn(`[Redis] Failed to clear hot state for provider ${providerId}: ${error?.message || error}`);
    return false;
  }
}

export async function clearAllHotState() {
  providerStateCache.clear();

  const client = await getRedisClient();
  if (!client) return false;

  try {
    if (typeof client.scanIterator === "function") {
      const keys = [];
      for await (const key of client.scanIterator({ MATCH: `${REDIS_PREFIX}*` })) {
        keys.push(key);
      }
      if (keys.length > 0) {
        await client.del(keys);
      }
      return keys.length > 0;
    }

    if (typeof client.keys === "function") {
      const keys = await client.keys(`${REDIS_PREFIX}*`);
      if (Array.isArray(keys) && keys.length > 0) {
        await client.del(keys);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.warn(`[Redis] Failed to clear all provider hot state: ${error?.message || error}`);
    return false;
  }
}

export async function mergeConnectionsWithHotState(connections = []) {
  if (!Array.isArray(connections) || connections.length === 0) return connections;

  const hotStates = await getConnectionHotStates(connections.map((connection) => ({
    id: connection.id,
    provider: connection.provider,
    ...connection,
  })));

  return connections.map((connection) => {
    const scopedKey = getProviderScopedConnectionKey(connection.provider, connection.id);
    return hotStates.get(scopedKey) || hotStates.get(connection.id) || connection;
  });
}

export function __resetProviderHotStateForTests() {
  providerStateCache.clear();
  redisClient = null;
  redisConnectPromise = null;
  redisDisabled = false;
}

export function __setRedisClientForTests(client) {
  redisClient = client;
  redisConnectPromise = null;
  redisDisabled = false;
}

export function __getProviderHotStateSnapshotForTests(providerId) {
  const providerState = providerStateCache.get(providerId);
  if (!providerState) return null;
  return {
    connections: Object.fromEntries(providerState.connections.entries()),
    eligibleConnectionIds: providerState.eligibleConnectionIds ? [...providerState.eligibleConnectionIds].sort() : null,
    retryAt: providerState.retryAt,
    updatedAt: providerState.updatedAt,
  };
}

export function __hydrateProviderHotStateForTests(providerId, rawState = {}) {
  return hydrateProviderState(providerId, rawState);
}
