import { NextResponse } from "next/server";
import { isCloudflareWorker } from "@/shared/utils/runtime";

// Shutdown app to release file locks for manual update
export async function POST() {
  // Shutdown is not applicable on Cloudflare Workers — no persistent process to kill
  if (isCloudflareWorker()) {
    return NextResponse.json(
      { success: false, message: "Shutdown is not supported on Cloudflare Workers" },
      { status: 501 }
    );
  }

  try {
    const { killAppProcesses } = await import("@/lib/appUpdater");
    await killAppProcesses();
  } catch { /* best effort */ }

  const response = NextResponse.json({ success: true, message: "Shutting down for manual update..." });

  setTimeout(() => process.exit(0), 500);

  return response;
}
