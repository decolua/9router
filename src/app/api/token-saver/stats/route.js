import { NextResponse } from "next/server";
import { getTokenSaverStats } from "@/lib/tokenSaver/events.js";
import { getPxpipeStats } from "@/lib/pxpipe/events.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawSince = searchParams.get("sinceMs");
    const rawTimeline = searchParams.get("timelineDays");
    const rawRecent = searchParams.get("recentLimit");

    const sinceMs = rawSince !== null && Number.isFinite(Number(rawSince)) ? Number(rawSince) : undefined;
    const timelineDays = Number.isFinite(Number(rawTimeline))
      ? Math.min(Math.max(Math.round(Number(rawTimeline)), 1), 90)
      : undefined;
    const recentLimit = Number.isFinite(Number(rawRecent))
      ? Math.min(Math.max(Math.round(Number(rawRecent)), 0), 500)
      : undefined;

    const tokenSaver = getTokenSaverStats({ sinceMs, timelineDays, recentLimit });
    let pxpipe = { windows: {}, timeline: [], recent: [] };
    try {
      const raw = getPxpipeStats({ timelineDays: timelineDays ?? 30, recentLimit: recentLimit ?? 100 });
      // Strip within-window cross-field percentages: this endpoint exposes
      // per-unit fields only, never savedPct.
      const windows = {};
      for (const [name, win] of Object.entries(raw.windows || {})) {
        const { savedPct, ...rest } = win || {};
        windows[name] = rest;
      }
      pxpipe = { windows, timeline: raw.timeline || [], recent: raw.recent || [] };
    } catch {
      pxpipe = { windows: {}, timeline: [], recent: [] };
    }

    const sources = {
      rtk: {
        state: "ok",
        unit: "chars",
        label: "chars reduced",
        source: "RTK events (chars)",
      },
      headroom: {
        state: tokenSaver.windows.all.proxyTokensSaved > 0 || tokenSaver.windows.all.bodyBytesReduced > 0
          ? "ok"
          : "unavailable",
        unit: "proxy-reported tokens + effective body bytes",
        label: "proxy-reported tokens",
        source: "aggregate events (no network)",
      },
      pxpipe: {
        state: pxpipe.windows.all ? "ok" : "unavailable",
        unit: "estimated tokens",
        label: "estimated tokens",
        source: "PXPIPE events (estimated tokens)",
        // caller owns pxpipe detail when present
      },
    };

    return NextResponse.json({
      windows: tokenSaver.windows,
      timeline: tokenSaver.timeline,
      recent: tokenSaver.recent,
      pxpipe,
      sources,
    });
  } catch {
    return NextResponse.json({
      windows: { all: { requests: 0 }, today: { requests: 0 }, yesterday: { requests: 0 }, last7d: { requests: 0 }, last30d: { requests: 0 } },
      timeline: [],
      recent: [],
      pxpipe: { windows: {}, timeline: [], recent: [] },
      sources: {
        rtk: { state: "unavailable", unit: "chars", label: "chars reduced", source: "RTK events (chars)" },
        headroom: { state: "unavailable", unit: "proxy-reported tokens + effective body bytes", label: "proxy-reported tokens", source: "aggregate events (no network)" },
        pxpipe: { state: "unavailable", unit: "estimated tokens", label: "estimated tokens", source: "PXPIPE events (estimated tokens)" },
      },
    });
  }
}
