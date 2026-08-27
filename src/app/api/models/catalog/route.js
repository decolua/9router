import { NextResponse } from "next/server";
import { buildModelsList } from "@/app/api/v1/models/route";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30_000;
const STALE_TTL_MS = 300_000;
if (!global.__modelsCatalogCache) global.__modelsCatalogCache = { data: null, ts: 0, promise: null };
if (!global.__modelsCatalogFastCache) global.__modelsCatalogFastCache = { data: null, ts: 0 };

async function getCachedModels(fast = false) {
  const now = Date.now();
  if (fast) {
    const fc = global.__modelsCatalogFastCache;
    if (fc.data && now - fc.ts < CACHE_TTL_MS) {
      return { models: fc.data, cached: true, stale: false };
    }
    const models = await buildModelsList(["llm"], { includeDisabled: true, fast: true });
    fc.data = models;
    fc.ts = Date.now();
    return { models, cached: false, stale: false };
  }
  const cache = global.__modelsCatalogCache;
  if (cache.data && now - cache.ts < CACHE_TTL_MS) {
    return { models: cache.data, cached: true, stale: false };
  }
  if (cache.data && now - cache.ts < STALE_TTL_MS) {
    // stale-while-revalidate: return stale immediately, refresh in background
    if (!cache.promise) {
      const p = buildModelsList(["llm"], { includeDisabled: true });
      cache.promise = p;
      p.then((models) => {
        cache.data = models;
        cache.ts = Date.now();
      }).catch(() => {}).finally(() => { cache.promise = null; });
    }
    return { models: cache.data, cached: true, stale: true };
  }
  if (cache.promise) {
    try {
      const models = await cache.promise;
      return { models, cached: true, stale: false };
    } catch {}
  }
  const promise = buildModelsList(["llm"], { includeDisabled: true });
  cache.promise = promise;
  try {
    const models = await promise;
    cache.data = models;
    cache.ts = Date.now();
    return { models, cached: false, stale: false };
  } finally {
    cache.promise = null;
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const fast = url.searchParams.get("fast") === "1";
    const { models, cached, stale } = await getCachedModels(fast);
    const headers = {};
    if (cached) headers["X-Cache"] = stale ? "STALE" : "HIT";
    else headers["X-Cache"] = "MISS";
    if (stale) headers["X-Cache-Stale"] = "1";
    return NextResponse.json({ object: "list", data: models }, { headers });
  } catch (error) {
    console.log("Error fetching dashboard model catalog:", error);
    return NextResponse.json(
      { error: "Failed to fetch model catalog" },
      { status: 500 },
    );
  }
}
