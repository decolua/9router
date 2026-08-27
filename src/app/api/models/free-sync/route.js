import { NextResponse } from "next/server";
import {
  getFreeModelSyncStatus,
  runFreeModelSync,
} from "@/shared/services/freeModelSync";

export const dynamic = "force-dynamic";

// GET /api/models/free-sync — scheduler status + per-provider catalog state
export async function GET() {
  try {
    const status = await getFreeModelSyncStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.log("Error reading free-model sync status:", error);
    return NextResponse.json({ error: "Failed to read free-model sync status" }, { status: 500 });
  }
}

// POST /api/models/free-sync — trigger a sync run immediately
export async function POST() {
  try {
    const result = await runFreeModelSync();
    return NextResponse.json(result);
  } catch (error) {
    console.log("Error running free-model sync:", error);
    return NextResponse.json({ error: "Failed to run free-model sync" }, { status: 500 });
  }
}
