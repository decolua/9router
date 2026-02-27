import { NextResponse } from "next/server";
import { clearAllRequestDetails } from "@/lib/usageDb";

/**
 * DELETE /api/usage/request-details/clear
 * Clear all request details from the database
 */
export async function DELETE() {
  try {
    const result = await clearAllRequestDetails();

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to clear request details" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("[API] Failed to clear request details:", error);
    return NextResponse.json(
      { error: "Failed to clear request details" },
      { status: 500 }
    );
  }
}
