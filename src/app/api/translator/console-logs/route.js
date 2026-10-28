import { NextResponse } from "next/server";
import { clearConsoleLogs, getConsoleLogSnapshot, initConsoleLogCapture } from "@/lib/consoleLogBuffer";

initConsoleLogCapture();

export async function GET(request) {
  try {
    const { logs, revision } = getConsoleLogSnapshot();
    const etag = `W/"console-${revision}"`;
    const headers = { "Cache-Control": "no-store", ETag: etag };

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    return NextResponse.json({ success: true, logs }, { headers });
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
