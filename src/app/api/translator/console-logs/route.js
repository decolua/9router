import { NextResponse } from "next/server";
import { clearConsoleLogs, getConsoleLogs, initConsoleLogCapture } from "@/lib/consoleLogBuffer";

initConsoleLogCapture();

export async function GET() {
  try {
    let logs = getConsoleLogs();

    try {
      const cfCtx = globalThis[Symbol.for("__cloudflare-context__")];
      if (cfCtx?.env?.DB) {
        const { getAdapter } = await import("@/lib/db/driver.js");
        const db = await getAdapter();
        if (typeof db.syncTable === "function") await db.syncTable("kv");

        const { makeKv } = await import("@/lib/db/helpers/kvStore.js");
        const kv = makeKv("system");
        const persistedLogs = await kv.get("console_logs", null);
        if (Array.isArray(persistedLogs)) {
          logs = persistedLogs;
        }
      }
    } catch {}

    return NextResponse.json({ success: true, logs: logs || [] });
  } catch (error) {
    console.error("Error getting console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await clearConsoleLogs();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error clearing console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
