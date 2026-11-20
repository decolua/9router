import { NextResponse } from "next/server";
import { clearConsoleLogs, getConsoleLogs, initConsoleLogCapture } from "@/lib/consoleLogBuffer";

initConsoleLogCapture();

export async function GET() {
  try {
    let logs = getConsoleLogs();
    if (!logs || logs.length === 0) {
      try {
        const { getRecentLogs } = await import("@/lib/usageDb");
        const recent = await getRecentLogs(50);
        if (recent.length > 0) {
          logs = recent.map((r) => `[LOG] ${r}`);
        }
      } catch {}
    }
    return NextResponse.json({ success: true, logs });
  } catch (error) {
    console.error("Error getting console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    clearConsoleLogs();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error clearing console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
