import { NextResponse } from "next/server";
import { getAllLatencyStats } from "@/lib/latencyMonitor.js";

export async function GET() {
  const stats = getAllLatencyStats();
  return NextResponse.json({
    providers: stats,
    count: stats.length,
    timestamp: new Date().toISOString(),
  });
}
