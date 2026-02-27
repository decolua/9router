import { getRedisJson, setRedisJson, deleteRedisJson } from "@/lib/redisCache";
import { LOCAL_DB_CACHE_KEYS, getUsageChartCacheKeys } from "@/lib/cacheKeys";
import { unstable_cache, revalidateTag } from "next/cache";
import { cache } from "react";

const API_CACHE_PREFIX = "9router";
const NEXT_CACHE_TAG_PREFIX = "api-cache";

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

export const getCachedValue = cache(async (key) => {
  if (!key) {
    return undefined;
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

  return redisValue;
});

export async function setCachedValue(key, value, ttlMs = 0) {
  if (!key || value === undefined || value === null) {
    return false;
  }

  const normalizedTtlMs = Math.max(Number(ttlMs) || 0, 0);
  const ttlSeconds = normalizedTtlMs > 0 ? Math.ceil(normalizedTtlMs / 1000) : 0;
  try {
    await setRedisJson(toRedisKey(key), value, ttlSeconds);
  } catch {
    // Ignore Redis write errors; Next cache still works.
  }

  return true;
}

export async function withApiCache(key, ttlMs, loader) {
  const cached = await getCachedValue(key);
  if (cached !== undefined) {
    return cached;
  }

  const value = await withNextCache(key, ttlMs, loader);
  await setCachedValue(key, value, ttlMs);
  return value;
}

export async function invalidateCacheKeys(keys = []) {
  const uniqueKeys = [...new Set((keys || []).filter(Boolean))];
  if (uniqueKeys.length === 0) {
    return;
  }

  for (const key of uniqueKeys) {
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
      // Ignore Redis delete failures
    }
  }));
}

export async function invalidateApiCachesForLocalDbChange() {
  await invalidateCacheKeys(LOCAL_DB_CACHE_KEYS);
}

export async function invalidateUsageChartCache() {
  await invalidateCacheKeys(getUsageChartCacheKeys());
}
