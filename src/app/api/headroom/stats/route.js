// GET /api/headroom/stats — in-process Headroom compression metrics
// Read-only; no auth required (internal stats, not secrets).
import { NextResponse } from "next/server";
import { getHeadroomStatsSnapshot } from "open-sse/rtk/headroomStats.js";
import { probeHeadroomCached } from "@/lib/headroom/probe";
import { getSettings } from "@/lib/localDb";
import { readFile } from "fs/promises";
import { resolve } from "path";

export const dynamic = "force-dynamic";

let _cachedVersion;
async function getVersion() {
  if (_cachedVersion) return _cachedVersion;
  try {
    const pkg = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8")
    );
    _cachedVersion = pkg.version ?? "unknown";
  } catch {
    _cachedVersion = "unknown";
  }
  return _cachedVersion;
}

export async function GET() {
  try {
    const snapshot = getHeadroomStatsSnapshot();
    const version = await getVersion();
    const settings = await getSettings();
    const probe = await probeHeadroomCached({ customUrl: settings.headroomUrl });

    return NextResponse.json({
      source: probe.source,
      health: {
        status: probe.ok ? "healthy" : "unhealthy",
        version,
        uptime_seconds: snapshot.uptime_seconds,
      },
      summary: snapshot.summary,
      savings: snapshot.savings,
    });
  } catch (error) {
    console.error("[API] /api/headroom/stats failed:", error);
    return NextResponse.json(
      { error: "Failed to retrieve headroom stats" },
      { status: 500 }
    );
  }
}
