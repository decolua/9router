import { NextResponse } from "next/server";
import { killAppProcesses, spawnUpdaterAndExit } from "@/lib/appUpdater";

export async function POST() {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { success: false, message: "Update is only available in production build (9router CLI)" },
      { status: 403 }
    );
  }

  try {
    // Kill sibling processes (cloudflared, MITM, stray next-server) to release file locks on Windows
    await killAppProcesses();
  } catch { /* best effort */ }

  // Schedule detached updater then exit current server process
  spawnUpdaterAndExit();

  return NextResponse.json({ success: true, message: "Updater started. This app will exit shortly." });
}
