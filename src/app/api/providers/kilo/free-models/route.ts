import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const KILO_MODELS_URL = "https://api.kilo.ai/api/gateway/models";

interface KiloModel {
  id: string;
  name: string;
  isFree?: boolean;
  context_length?: number;
}

interface FreeModel {
  id: string;
  name: string;
  isFree: true;
  context_length: number;
}

// In-memory cache with TTL
let cachedModels: FreeModel[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET(_request: NextRequest, context: { params: Promise<{}> }) {
  await context.params;
  const now = Date.now();

  if (cachedModels && now - cacheTimestamp < CACHE_TTL_MS) {
    return NextResponse.json({ models: cachedModels, cached: true });
  }

  try {
    const res = await fetch(KILO_MODELS_URL, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`Kilo API returned ${res.status}`);
    }

    const json = await res.json() as { data?: KiloModel[] };
    const allModels = json.data ?? [];

    const freeModels: FreeModel[] = allModels
      .filter((m) => m.isFree === true)
      .map((m) => ({
        id: m.id,
        name: m.name,
        isFree: true as const,
        context_length: m.context_length ?? 0,
      }));

    cachedModels = freeModels;
    cacheTimestamp = now;

    return NextResponse.json({ models: freeModels, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cachedModels) {
      return NextResponse.json({ models: cachedModels, cached: true, warning: message });
    }
    return NextResponse.json(
      { models: [], error: `Failed to fetch Kilo models: ${message}` },
      { status: 502 },
    );
  }
}
