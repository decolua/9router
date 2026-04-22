import { NextResponse } from "next/server";

import { getQuotaRefreshScheduler } from "@/lib/quotaRefreshScheduler";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "manual_api";

    const scheduler = getQuotaRefreshScheduler();
    const result = await scheduler.requestManualRun(reason);

    if (!result.accepted && result.reason === "scheduler_disabled") {
      return NextResponse.json(result, { status: 409 });
    }

    const status = result.reason === "restart_requested" ? 202 : 200;
    return NextResponse.json(result, { status });
  } catch (error) {
    console.error("[Quota Refresh Run API] Failed to request manual run:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
