import { NextResponse } from "next/server";
import { isCloudflareWorker } from "@/shared/utils/runtime";

export async function POST() {
  // Self-update is not applicable on Cloudflare Workers — no local process to update
  if (isCloudflareWorker()) {
    return NextResponse.json(
      { success: false, message: "Self-update is not supported on Cloudflare Workers. Deploy via wrangler instead." },
      { status: 501 }
    );
  }

  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { success: false, message: "Update is only available in production build (9router CLI)" },
      { status: 403 }
    );
  }

  try {
    const { killAppProcesses, spawnUpdaterAndExit } = await import("@/lib/appUpdater");
    // Kill sibling processes (cloudflared, MITM, stray next-server) to release file locks on Windows
    await killAppProcesses();
    // Schedule detached updater then exit current server process
    spawnUpdaterAndExit();
  } catch (e) {
    return NextResponse.json(
      { success: false, message: `Update failed: ${e.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, message: "Updater started. This app will exit shortly." });
}
