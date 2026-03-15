import { NextResponse } from "next/server";
import { getUsageDb } from "@/lib/usageDb";

export async function POST() {
  try {
    const db = await getUsageDb();

    // Clear all usage history
    db.data.history = [];

    await db.write();

    return NextResponse.json({
      success: true,
      message: "All usage metrics cleared successfully"
    });
  } catch (error) {
    console.error("Error clearing usage metrics:", error);
    return NextResponse.json(
      { error: "Failed to clear usage metrics" },
      { status: 500 }
    );
  }
}
