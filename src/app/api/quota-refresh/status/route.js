import { NextResponse } from "next/server";

import { getQuotaRefreshScheduler } from "@/lib/quotaRefreshScheduler";

export async function GET() {
  try {
    const scheduler = getQuotaRefreshScheduler();
    const status = await scheduler.getStatusSnapshot({ refreshSettings: true });
    return NextResponse.json(status);
  } catch (error) {
    console.error("[Quota Refresh Status API] Failed to read scheduler status:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
