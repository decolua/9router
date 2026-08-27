import { NextResponse } from "next/server";
import { buildModelsList } from "@/app/api/v1/models/route";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30_000;
if (!global.__modelsCatalogCache) global.__modelsCatalogCache = { data: null, ts: 0, promise: null };

async function getCachedModels() {
  const now = Date.now();
  const cache = global.__modelsCatalogCache;
  if (cache.data && now - cache.ts < CACHE_TTL_MS) {
    return { models: cache.data, cached: true };
  }
  if (cache.promise) {
    try {
      const models = await cache.promise;
      return { models, cached: true };
    } catch {
      // fall through to fresh fetch
    }
  }
  const promise = buildModelsList(["llm"], { includeDisabled: true });
  cache.promise = promise;
  try {
    const models = await promise;
    cache.data = models;
    cache.ts = Date.now();
    return { models, cached: false };
  } finally {
    cache.promise = null;
  }
}

export async function GET() {
  try {
    const { models, cached } = await getCachedModels();
    return NextResponse.json({ object: "list", data: models }, {
      headers: cached ? { "X-Cache": "HIT" } : { "X-Cache": "MISS" },
    });
  } catch (error) {
    console.log("Error fetching dashboard model catalog:", error);
    return NextResponse.json(
      { error: "Failed to fetch model catalog" },
      { status: 500 },
    );
  }
}
