import { NextResponse } from "next/server";
import { getQoderBulkImportManager } from "@/lib/oauth/services/qoderBulkImportManager";

export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/qoder/bulk-import/latest
 * Get the latest recoverable bulk import job
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") || "recoverable";

    const manager = getQoderBulkImportManager();
    const job = await manager.getLatestJob(scope);

    if (!job) {
      return NextResponse.json(
        { error: "No recoverable job found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to get latest job" },
      { status: 500 }
    );
  }
}
