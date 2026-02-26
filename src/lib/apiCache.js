import { getRedisJson, setRedisJson, deleteRedisJson } from "@/lib/redisCache";
import { LOCAL_DB_CACHE_KEYS, getUsageChartCacheKeys } from "@/lib/cacheKeys";
import { unstable_cache, revalidateTag } from "next/cache";

const API_CACHE_PREFIX = "9router";
const NEXT_CACHE_TAG_PREFIX = "api-cache";
const MEMORY_CACHE_STORE_KEY = "__nineRouterApiCacheStore";
const MEMORY_CACHE_INFLIGHT_KEY = "__nineRouterApiCacheInflight";
const REDIS_TO_MEMORY_TTL_MS = 1000;

function getMemoryStore() {
  if (!globalThis[MEMORY_CACHE_STORE_KEY]) {
    globalThis[MEMORY_CACHE_STORE_KEY] = new Map();
  }

  return globalThis[MEMORY_CACHE_STORE_KEY];
}

function getInflightStore() {
  if (!globalThis[MEMORY_CACHE_INFLIGHT_KEY]) {
    globalThis[MEMORY_CACHE_INFLIGHT_KEY] = new Map();
  }

  return globalThis[MEMORY_CACHE_INFLIGHT_KEY];
}

function toRedisKey(key) {
  return `${API_CACHE_PREFIX}:${key}`;
}

function toNextCacheTag(key) {
  return `${NEXT_CACHE_TAG_PREFIX}:${key}`;
}

function withNextCache(key, ttlMs, loader) {
  const normalizedTtlMs = Math.max(Number(ttlMs) || 0, 0);
  if (!key || normalizedTtlMs <= 0) {
    return loader();
  }

  const revalidateSeconds = Math.max(Math.floor(normalizedTtlMs / 1000), 1);
  const cachedLoader = unstable_cache(loader, [key], {
    revalidate: revalidateSeconds,
    tags: [toNextCacheTag(key)],
  });

  return cachedLoader();
}

function readMemoryCache(key) {
  const store = getMemoryStore();
  const entry = store.get(key);

  if (!entry) {
    return { hit: false, value: undefined };
  }

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return { hit: false, value: undefined };
  }

  return { hit: true, value: entry.value };
}

function writeMemoryCache(key, value, ttlMs) {
  if (ttlMs <= 0) {
    return;
  }

  const store = getMemoryStore();
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export async function getCachedValue(key) {
  if (!key) {
    return undefined;
  }

  const memory = readMemoryCache(key);
  if (memory.hit) {
    return memory.value;
  }

  let redisValue = null;
  try {
    redisValue = await getRedisJson(toRedisKey(key));
  } catch {
    redisValue = null;
  }

  if (redisValue === null || redisValue === undefined) {
    return undefined;
  }

  writeMemoryCache(key, redisValue, REDIS_TO_MEMORY_TTL_MS);
  return redisValue;
}

export async function setCachedValue(key, value, ttlMs = 0) {
  if (!key || value === undefined || value === null) {
    return false;
  }

  const normalizedTtlMs = Math.max(Number(ttlMs) || 0, 0);
  writeMemoryCache(key, value, normalizedTtlMs);

  const ttlSeconds = normalizedTtlMs > 0 ? Math.ceil(normalizedTtlMs / 1000) : 0;
  try {
    await setRedisJson(toRedisKey(key), value, ttlSeconds);
  } catch {
    // Ignore Redis write errors; memory/Next cache still works.
  }

  return true;
}

export async function withApiCache(key, ttlMs, loader) {
  const cached = await getCachedValue(key);
  if (cached !== undefined) {
    return cached;
  }

  const inflight = getInflightStore();
  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const task = (async () => {
    const value = await withNextCache(key, ttlMs, loader);
    await setCachedValue(key, value, ttlMs);
    return value;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, task);
  return task;
}

export async function invalidateCacheKeys(keys = []) {
  const uniqueKeys = [...new Set((keys || []).filter(Boolean))];
  if (uniqueKeys.length === 0) {
    return;
  }

  const store = getMemoryStore();
  for (const key of uniqueKeys) {
    store.delete(key);

    try {
      revalidateTag(toNextCacheTag(key), "max");
    } catch {
      // Ignore Next.js cache revalidation errors and keep Redis/memory invalidation best-effort.
    }
  }

  await Promise.all(uniqueKeys.map(async (key) => {
    try {
      await deleteRedisJson(toRedisKey(key));
    } catch {
      // Ignore Redis delete failures; memory/Next cache invalidation already happened.
    }
  }));
}

export async function invalidateApiCachesForLocalDbChange() {
  await invalidateCacheKeys(LOCAL_DB_CACHE_KEYS);
}

export async function invalidateUsageChartCache() {
  await invalidateCacheKeys(getUsageChartCacheKeys());
}
