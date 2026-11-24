import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { killAppProcesses, spawnUpdaterAndExit } from "@/lib/appUpdater";

export async function POST() {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { success: false, message: "Update is only available in production build (9router CLI)" },
      { status: 403 }
    );
  }

  const dockerTriggerFile = process.env.DOCKER_UPDATE_TRIGGER_FILE;
  if (dockerTriggerFile) {
    try {
      fs.mkdirSync(path.dirname(dockerTriggerFile), { recursive: true });
      fs.writeFileSync(dockerTriggerFile, JSON.stringify({ requestedAt: new Date().toISOString() }));
      return NextResponse.json({ success: true, message: "Docker update started." }, { status: 202 });
    } catch (error) {
      return NextResponse.json(
        { success: false, message: `Failed to request Docker update: ${error.message}` },
        { status: 500 }
      );
    }
  }

  try {
    // Kill sibling processes (cloudflared, MITM, stray next-server) to release file locks on Windows
    await killAppProcesses();
  } catch { /* best effort */ }

  // Schedule detached updater then exit current server process
  spawnUpdaterAndExit();

  return NextResponse.json({ success: true, message: "Updater started. This app will exit shortly." });
}
