import { NextResponse } from "next/server";
import { getRecentLogs, clearAllLogs } from "@/lib/usageDb";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const search = searchParams.get("search") || "";

    const result = await getRecentLogs({ limit, page, search });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[API ERROR] /api/usage/request-logs failed:", error);
    console.error("[API ERROR] Stack:", error?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const success = await clearAllLogs();
    if (success) {
      return NextResponse.json({ success: true, message: "Logs cleared" });
    } else {
      return NextResponse.json({ error: "Failed to clear logs" }, { status: 500 });
    }
  } catch (error) {
    console.error("[API ERROR] /api/usage/request-logs DELETE failed:", error);
    return NextResponse.json({ error: "Failed to clear logs" }, { status: 500 });
  }
}
