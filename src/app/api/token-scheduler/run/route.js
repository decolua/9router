import { NextResponse } from "next/server";
import { runNow } from "@/lib/tokenScheduler/scheduler";

export const runtime = "nodejs";

/**
 * POST /api/token-scheduler/run
 * Trigger an immediate scheduler tick (manual "Run Now").
 */
export async function POST() {
  try {
    const results = await runNow();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("[TokenScheduler API] Run error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
