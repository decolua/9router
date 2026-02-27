import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";

export async function GET() {
  try {
    const data = await getRecentLogs({ limit: 200 });
    // Assuming the old route expects an array
    return NextResponse.json(data.logs || []);
  } catch (error) {
    console.error("Error fetching logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
