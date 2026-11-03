import { NextResponse } from "next/server";
import {
  getFsCacheStatus,
  clearFsCacheSync,
  pruneFsCacheSync,
  normalizeTtlMs,
  normalizeMaxSizeBytes,
} from "open-sse/rtk/fsCache.js";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET() {
  try {
    const status = getFsCacheStatus();
    return NextResponse.json(status, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to read token cache status" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "clear";
    if (action === "prune") {
      const settings = await getSettings();
      const ttlMs = normalizeTtlMs(settings.fsCacheTtlHours);
      const maxSizeBytes = normalizeMaxSizeBytes(settings.fsCacheMaxSizeMb);
      pruneFsCacheSync({ ttlMs, maxSizeBytes });
      return NextResponse.json(getFsCacheStatus(), { headers: NO_STORE_HEADERS });
    }
    const scope = ["blocks", "responses", "all"].includes(body.scope) ? body.scope : "all";
    const status = clearFsCacheSync(scope);
    return NextResponse.json(status, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to update token cache" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const scopeParam = searchParams.get("scope");
    const scope = ["blocks", "responses", "all"].includes(scopeParam) ? scopeParam : "all";
    const status = clearFsCacheSync(scope);
    return NextResponse.json(status, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to clear token cache" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

