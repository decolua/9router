import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";

export async function GET() {
  try {
    const logs = await getRecentLogs(200);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("[API ERROR] /api/usage/logs failed:", error);
    console.error("[API ERROR] Stack:", error?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run("DELETE FROM usageHistory");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API ERROR] DELETE /api/usage/request-logs failed:", error);
    return NextResponse.json({ error: "Failed to clear request logs" }, { status: 500 });
  }
}
