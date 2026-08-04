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
    // Stop only verified services owned by this 9router data directory.
    await killAppProcesses();
  } catch { /* best effort */ }

  // Do not terminate the app unless the detached updater actually starts.
  const updaterStarted = await spawnUpdaterAndExit();
  if (!updaterStarted) {
    return NextResponse.json(
      { success: false, message: "Updater could not start; 9router is still running." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, message: "Updater started. This app will exit shortly." });
}
