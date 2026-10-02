import { NextResponse } from "next/server";

import {
  qoderSchedulerStatus,
  setQoderSchedulerEnabled,
  triggerQoderScheduler,
} from "@/shared/services/qoderScheduler.js";

/**
 * GET  /api/qoder/scheduler          调度器状态与排程日志
 * POST /api/qoder/scheduler          手动控制
 *   body: { action: "trigger" | "enable" | "disable" }
 */
export async function GET() {
  try {
    return NextResponse.json(qoderSchedulerStatus());
  } catch (error) {
    console.error("[API] Failed to read Qoder scheduler status:", error);
    return NextResponse.json({ error: "Failed to read scheduler status" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "trigger";

    if (action === "trigger") {
      const res = await triggerQoderScheduler();
      return NextResponse.json({ ...res, status: qoderSchedulerStatus() });
    }
    if (action === "enable" || action === "disable") {
      setQoderSchedulerEnabled(action === "enable");
      return NextResponse.json({ ok: true, status: qoderSchedulerStatus() });
    }
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("[API] Qoder scheduler action failed:", error);
    return NextResponse.json({ error: "Scheduler action failed" }, { status: 500 });
  }
}