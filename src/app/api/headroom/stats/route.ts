// GET /api/headroom/stats — in-process Headroom compression metrics
// Read-only; no auth required (internal stats, not secrets).
import { NextResponse } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { getHeadroomStatsSnapshot } from "open-sse/rtk/headroomStats.js";
import { probeHeadroomCached } from "@/lib/headroom/probe";
import { getSettings } from "@/lib/localDb";
import { readFile } from "fs/promises";
import { resolve } from "path";

export const dynamic = "force-dynamic";

let _cachedVersion: string | undefined;
async function getVersion() {
  if (_cachedVersion) return _cachedVersion;
  try {
    const raw = await readFile(resolve(process.cwd(), "package.json"), "utf8");
    const pkg: JsonValue = JSON.parse(raw) as JsonValue;
    _cachedVersion =
      pkg !== null && typeof pkg === "object" && !Array.isArray(pkg) && typeof pkg["version"] === "string"
        ? pkg["version"]
        : "unknown";
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
    return NextResponse.json({ error: "Failed to retrieve headroom stats" }, { status: 500 });
  }
}
