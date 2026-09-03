import { NextResponse } from "next/server";
import { killAppProcesses, spawnUpdaterAndExit } from "@/lib/appUpdater";
import { UPDATER_CONFIG } from "@/shared/constants/config";

export async function POST() {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      {
        success: false,
        message:
          "Auto-update only works with the production 9router CLI install (not npm run dev). Use the manual install command instead.",
      },
      { status: 403 }
    );
  }

  try {
    // Kill sibling processes (cloudflared, MITM, stray next-server) to release file locks on Windows
    await killAppProcesses();
  } catch { /* best effort */ }

  // Schedule detached updater then exit current server process.
  // Pin @latest so npm always prefers the registry tip (matches installCmdLatest).
  spawnUpdaterAndExit(`${UPDATER_CONFIG.npmPackageName}@latest`);

  return NextResponse.json({
    success: true,
    message: "Updater started. This app will exit shortly.",
    statusUrl: `http://127.0.0.1:${UPDATER_CONFIG.statusPort}/update/status`,
  });
}
