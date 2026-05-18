import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();

    return NextResponse.json({
      enabled: settings.webshareAutoSyncEnabled,
      lastSyncAt: settings.webshareLastSyncAt,
      lastSyncError: settings.webshareLastSyncError,
      lastSyncStats: settings.webshareLastSyncStats,
      intervalMinutes: settings.webshareSyncIntervalMinutes,
      hasApiKey: !!settings.webshareApiKey,
    });
  } catch (error) {
    console.log("Error fetching Webshare sync status:", error);
    return NextResponse.json({ error: "Failed to fetch Webshare sync status" }, { status: 500 });
  }
}
