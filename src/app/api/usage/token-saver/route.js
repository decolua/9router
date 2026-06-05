import { NextResponse } from "next/server";
import { getRequestDetails } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

function startDateForPeriod(period) {
  const now = new Date();
  if (period === "all") return null;
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const hours = period === "24h" ? 24 : null;
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "60d" ? 60 : null;
  const ms = hours ? hours * 60 * 60 * 1000 : days * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

function emptySummary(period) {
  return {
    period,
    summary: {
      totalRequests: 0,
      optimizedRequests: 0,
      rtkRequests: 0,
      cavemanRequests: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      savedBytes: 0,
      savedPercent: 0,
      filtersUsed: [],
      cavemanLevels: {},
    },
    requests: [],
    pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false },
  };
}

/**
 * GET /api/usage/token-saver?period=today|24h|7d|30d|60d|all&page=1&pageSize=50
 * Returns requestDetails rows that contain tokenSaver metadata plus aggregate stats.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "today";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const startDate = startDateForPeriod(period);
    const filter = { page: 1, pageSize: 1000 };
    if (startDate) filter.startDate = startDate;

    const result = await getRequestDetails(filter);
    const details = result.details || [];
    if (details.length === 0) return NextResponse.json(emptySummary(period));

    const summary = {
      totalRequests: details.length,
      optimizedRequests: 0,
      rtkRequests: 0,
      cavemanRequests: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      savedBytes: 0,
      savedPercent: 0,
      filtersUsed: [],
      cavemanLevels: {},
    };
    const filters = new Set();

    const optimized = [];
    for (const item of details) {
      const ts = item.tokenSaver;
      if (!ts) continue;

      summary.optimizedRequests += 1;
      if (ts.rtk) {
        summary.rtkRequests += 1;
        summary.bytesBefore += ts.rtk.bytesBefore || 0;
        summary.bytesAfter += ts.rtk.bytesAfter || 0;
        summary.savedBytes += ts.rtk.savedBytes || 0;
        for (const f of ts.rtk.filtersUsed || []) filters.add(f);
      }
      if (ts.caveman) {
        summary.cavemanRequests += 1;
        const lvl = ts.caveman.level || "unknown";
        summary.cavemanLevels[lvl] = (summary.cavemanLevels[lvl] || 0) + 1;
      }

      optimized.push({
        id: item.id,
        timestamp: item.timestamp,
        provider: item.provider,
        model: item.model,
        status: item.status,
        latency: item.latency,
        tokens: item.tokens,
        tokenSaver: ts,
      });
    }

    summary.savedPercent = summary.bytesBefore > 0
      ? Number(((summary.savedBytes / summary.bytesBefore) * 100).toFixed(1))
      : 0;
    summary.filtersUsed = [...filters].sort();

    const totalItems = optimized.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const offset = (page - 1) * pageSize;
    const requests = optimized.slice(offset, offset + pageSize);

    return NextResponse.json({
      period,
      summary,
      requests,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("[API] Failed to get token saver stats:", error);
    return NextResponse.json({ error: "Failed to fetch token saver stats" }, { status: 500 });
  }
}
