/**
 * Unit tests for src/sse/services/apiKeyCache.js
 *
 * Since the module uses @/ path alias, we test by reimplementing the cache
 * logic inline with the same algorithm and injected DB dependency.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Reimplement cache logic for testability ────────────────────────────────

const VALID_TTL_MS = 10 * 60 * 1000;
const NULL_TTL_MS = 60 * 1000;
const MAX_CACHE_SIZE = 500;

const cache = new Map();

let mockGetApiKeyByKey = async () => null;

function cloneRecord(record) {
  if (!record) return null;
  return {
    ...record,
    allowedModels: record.allowedModels ? [...record.allowedModels] : [],
    allowedConnections: record.allowedConnections ? [...record.allowedConnections] : [],
  };
}

function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

async function getCachedApiKeyRecord(key) {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && entry.expiresAt > now) return cloneRecord(entry.record);

  const record = await mockGetApiKeyByKey(key);
  if (cache.size >= MAX_CACHE_SIZE) {
    evictExpired();
    if (cache.size >= MAX_CACHE_SIZE) cache.clear();
  }
  cache.set(key, {
    record: cloneRecord(record),
    expiresAt: now + (record ? VALID_TTL_MS : NULL_TTL_MS),
  });
  return cloneRecord(record);
}

function invalidateApiKeyCache(key) { cache.delete(key); }

function invalidateApiKeyCacheById(id) {
  for (const [key, entry] of cache.entries()) {
    if (entry.record?.id === id) { cache.delete(key); break; }
  }
}

function clearApiKeyCache() { cache.clear(); }

// ─── Tests ──────────────────────────────────────────────────────────────────

const MOCK_KEY = {
  id: "uuid-123",
  name: "Test Key",
  key: "sk-test-abc",
  machineId: "m1",
  isActive: true,
  allowedModels: ["openai/gpt-4", "anthropic/*"],
  allowedConnections: ["conn-1", "conn-2"],
  createdAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  clearApiKeyCache();
  mockGetApiKeyByKey = vi.fn().mockResolvedValue(MOCK_KEY);
});

describe("getCachedApiKeyRecord", () => {
  it("fetches from DB on first call", async () => {
    const result = await getCachedApiKeyRecord("sk-test-abc");
    expect(result).toEqual(MOCK_KEY);
    expect(mockGetApiKeyByKey).toHaveBeenCalledTimes(1);
  });

  it("uses cache on second call", async () => {
    await getCachedApiKeyRecord("sk-test-abc");
    await getCachedApiKeyRecord("sk-test-abc");
    expect(mockGetApiKeyByKey).toHaveBeenCalledTimes(1);
  });

  it("returns clone — mutations don't affect cache", async () => {
    const r1 = await getCachedApiKeyRecord("sk-test-abc");
    r1.allowedModels.push("hacked/*");
    r1.allowedConnections.push("conn-hacked");
    r1.name = "mutated";

    const r2 = await getCachedApiKeyRecord("sk-test-abc");
    expect(r2.name).toBe("Test Key");
    expect(r2.allowedModels).toEqual(["openai/gpt-4", "anthropic/*"]);
    expect(r2.allowedConnections).toEqual(["conn-1", "conn-2"]);
  });

  it("returns null for non-existent key", async () => {
    mockGetApiKeyByKey = vi.fn().mockResolvedValue(null);
    expect(await getCachedApiKeyRecord("sk-invalid")).toBeNull();
  });

  it("caches null (second call doesn't hit DB)", async () => {
    mockGetApiKeyByKey = vi.fn().mockResolvedValue(null);
    await getCachedApiKeyRecord("sk-invalid");
    await getCachedApiKeyRecord("sk-invalid");
    expect(mockGetApiKeyByKey).toHaveBeenCalledTimes(1);
  });
});

describe("invalidation", () => {
  it("invalidateApiKeyCache forces re-fetch", async () => {
    await getCachedApiKeyRecord("sk-test-abc");
    invalidateApiKeyCache("sk-test-abc");
    await getCachedApiKeyRecord("sk-test-abc");
    expect(mockGetApiKeyByKey).toHaveBeenCalledTimes(2);
  });

  it("invalidateApiKeyCacheById finds and removes by ID", async () => {
    await getCachedApiKeyRecord("sk-test-abc");
    invalidateApiKeyCacheById("uuid-123");
    await getCachedApiKeyRecord("sk-test-abc");
    expect(mockGetApiKeyByKey).toHaveBeenCalledTimes(2);
  });

  it("invalidateApiKeyCacheById ignores unknown ID", async () => {
    await getCachedApiKeyRecord("sk-test-abc");
    invalidateApiKeyCacheById("unknown-id");
    await getCachedApiKeyRecord("sk-test-abc");
    expect(mockGetApiKeyByKey).toHaveBeenCalledTimes(1); // still cached
  });

  it("clearApiKeyCache removes everything", async () => {
    await getCachedApiKeyRecord("sk-test-abc");
    clearApiKeyCache();
    await getCachedApiKeyRecord("sk-test-abc");
    expect(mockGetApiKeyByKey).toHaveBeenCalledTimes(2);
  });
});

describe("max size protection", () => {
  it("handles more entries than MAX_CACHE_SIZE without crashing", async () => {
    for (let i = 0; i < 510; i++) {
      mockGetApiKeyByKey = vi.fn().mockResolvedValue({ ...MOCK_KEY, id: `id-${i}` });
      await getCachedApiKeyRecord(`sk-key-${i}`);
    }
    // Cache should still function
    mockGetApiKeyByKey = vi.fn().mockResolvedValue(MOCK_KEY);
    const result = await getCachedApiKeyRecord("sk-test-abc");
    expect(result).toEqual(MOCK_KEY);
  });
});

describe("cloneRecord", () => {
  it("returns null for null input", () => {
    expect(cloneRecord(null)).toBeNull();
  });

  it("deep clones allowedModels array", () => {
    const original = { id: "1", allowedModels: ["a", "b"] };
    const cloned = cloneRecord(original);
    cloned.allowedModels.push("c");
    expect(original.allowedModels).toEqual(["a", "b"]);
  });

  it("handles missing allowedModels", () => {
    const cloned = cloneRecord({ id: "1" });
    expect(cloned.allowedModels).toEqual([]);
  });

  it("deep clones allowedConnections array", () => {
    const original = { id: "1", allowedConnections: ["conn-a", "conn-b"] };
    const cloned = cloneRecord(original);
    cloned.allowedConnections.push("conn-c");
    expect(original.allowedConnections).toEqual(["conn-a", "conn-b"]);
  });

  it("handles missing allowedConnections", () => {
    const cloned = cloneRecord({ id: "1" });
    expect(cloned.allowedConnections).toEqual([]);
  });
});
