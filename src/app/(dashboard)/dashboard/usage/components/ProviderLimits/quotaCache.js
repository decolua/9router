"use client";

import { parseQuotaData } from "./utils";

export const PROVIDER_QUOTA_CACHE_KEY = "providerQuotaSnapshots:v1";
export const PROVIDER_QUOTA_CACHE_TTL_MS = 15 * 60 * 1000;

const inflightRequests = new Map();
let memoryCache = null;

function getNow() {
  return Date.now();
}

function getStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function normalizeCacheEntry(entry, fallbackSavedAt = getNow()) {
  if (!entry || typeof entry !== "object") return null;
  return {
    quotas: Array.isArray(entry.quotas) ? entry.quotas : [],
    plan: entry.plan || null,
    message: entry.message || null,
    savedAt: Number(entry.savedAt || fallbackSavedAt || getNow()),
  };
}

function loadCacheItems() {
  if (memoryCache) return memoryCache;

  const storage = getStorage();
  if (!storage) {
    memoryCache = {};
    return memoryCache;
  }

  try {
    const raw = storage.getItem(PROVIDER_QUOTA_CACHE_KEY);
    if (!raw) {
      memoryCache = {};
      return memoryCache;
    }

    const parsed = JSON.parse(raw);
    const fallbackSavedAt = Number(parsed?.savedAt || 0);
    if (!parsed?.items || typeof parsed.items !== "object") {
      memoryCache = {};
      return memoryCache;
    }

    memoryCache = Object.fromEntries(
      Object.entries(parsed.items)
        .map(([id, entry]) => [id, normalizeCacheEntry(entry, fallbackSavedAt)])
        .filter(([, entry]) => entry),
    );
  } catch {
    memoryCache = {};
  }

  return memoryCache;
}

function saveCacheItems(items) {
  memoryCache = items;
  const storage = getStorage();
  if (!storage) return;

  try {
    const entries = Object.entries(items).filter(([, entry]) => entry);
    if (entries.length === 0) {
      storage.removeItem(PROVIDER_QUOTA_CACHE_KEY);
      return;
    }

    const savedAt = entries.reduce(
      (max, [, entry]) => Math.max(max, Number(entry.savedAt || 0)),
      0,
    );

    storage.setItem(
      PROVIDER_QUOTA_CACHE_KEY,
      JSON.stringify({ savedAt, items: Object.fromEntries(entries) }),
    );
  } catch {}
}

function isFreshCacheEntry(entry) {
  return !!entry && getNow() - Number(entry.savedAt || 0) <= PROVIDER_QUOTA_CACHE_TTL_MS;
}

export function readQuotaCache({ includeStale = false } = {}) {
  const items = loadCacheItems();
  return Object.fromEntries(
    Object.entries(items).filter(([, entry]) => includeStale || isFreshCacheEntry(entry)),
  );
}

export function getCachedQuotaDataForConnections(
  connections = [],
  { includeStale = false } = {},
) {
  const ids = new Set(connections.map((conn) => conn?.id).filter(Boolean));
  const items = readQuotaCache({ includeStale });

  return Object.fromEntries(
    Object.entries(items).filter(([id]) => ids.has(id)),
  );
}

export function mergeQuotaCacheEntries(entries = {}) {
  const current = readQuotaCache({ includeStale: true });
  const savedAt = getNow();
  const next = { ...current };

  Object.entries(entries).forEach(([id, entry]) => {
    const normalized = normalizeCacheEntry(entry, savedAt);
    if (id && normalized) next[id] = normalized;
  });

  saveCacheItems(next);
  return next;
}

export function removeQuotaCacheEntries(ids = []) {
  const current = readQuotaCache({ includeStale: true });
  let changed = false;
  ids.forEach((id) => {
    if (id && current[id]) {
      delete current[id];
      changed = true;
    }
  });
  if (changed) saveCacheItems(current);
}

export async function fetchQuotaWithCache(connection, { force = false } = {}) {
  if (!connection?.id || !connection?.provider) {
    return { entry: null, fromCache: false };
  }

  const cached = getCachedQuotaDataForConnections([connection])[connection.id];
  if (!force && cached) {
    return { entry: cached, fromCache: true };
  }

  if (inflightRequests.has(connection.id)) {
    return inflightRequests.get(connection.id);
  }

  const request = (async () => {
    try {
      const response = await fetch(`/api/usage/${connection.id}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || response.statusText;

        if (response.status === 404) {
          removeQuotaCacheEntries([connection.id]);
          return { entry: null, fromCache: false, notFound: true };
        }

        if (response.status === 401) {
          const entry = normalizeCacheEntry({
            quotas: [],
            message: errorMsg,
          });
          mergeQuotaCacheEntries({ [connection.id]: entry });
          return { entry, fromCache: false };
        }

        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const data = await response.json();
      const entry = normalizeCacheEntry({
        quotas: parseQuotaData(connection.provider, data),
        plan: data.plan || null,
        message: data.message || null,
      });

      mergeQuotaCacheEntries({ [connection.id]: entry });
      return { entry, fromCache: false };
    } catch (error) {
      const stale = getCachedQuotaDataForConnections([connection], {
        includeStale: true,
      })[connection.id];
      if (stale) return { entry: stale, fromCache: true, stale: true, error };
      throw error;
    } finally {
      inflightRequests.delete(connection.id);
    }
  })();

  inflightRequests.set(connection.id, request);
  return request;
}
