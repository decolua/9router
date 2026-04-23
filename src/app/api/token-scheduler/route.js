import { NextResponse } from "next/server";
import {
  getSchedulerStatus,
  startScheduler,
  stopScheduler,
  updateSchedulerSettings,
  initScheduler,
} from "@/lib/tokenScheduler/scheduler";

export const runtime = "nodejs";

/**
 * GET /api/token-scheduler
 * Returns current scheduler status, stats, and recovery log.
 * Auto-starts the scheduler on first access if Antigravity accounts exist.
 */
export async function GET() {
  try {
    await initScheduler(); // auto-start if not running and accounts exist
    const status = await getSchedulerStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("[TokenScheduler API] GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/token-scheduler
 * Update scheduler settings and/or start/stop the scheduler.
 *
 * Body: {
 *   action?: "start" | "stop",
 *   checkInterval?: number (ms),
 *   preRefreshWindow?: number (ms),
 * }
 */
export async function PATCH(request) {
  try {
    const body = await request.json();

    if (body.action === "start") {
      await startScheduler();
    } else if (body.action === "stop") {
      stopScheduler();
    }

    if (body.checkInterval || body.preRefreshWindow) {
      await updateSchedulerSettings({
        checkInterval: body.checkInterval,
        preRefreshWindow: body.preRefreshWindow,
      });
    }

    const status = await getSchedulerStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error("[TokenScheduler API] PATCH error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
