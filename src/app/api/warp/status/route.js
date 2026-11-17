import { NextResponse } from "next/server";
import { getStatus } from "@/lib/warp";

// GET /api/warp/status - WARP hop engine state
export async function GET() {
  try {
    return NextResponse.json({ status: getStatus() });
  } catch (error) {
    console.log("Error fetching WARP status:", error);
    return NextResponse.json({ error: "Failed to fetch WARP status" }, { status: 500 });
  }
}
