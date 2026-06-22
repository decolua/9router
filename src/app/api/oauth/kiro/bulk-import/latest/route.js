import { NextResponse } from "next/server";
import { getKiroBulkImportManager } from "@/lib/oauth/services/kiroBulkImportManager";

export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/kiro/bulk-import/latest
 * Get the latest recoverable bulk import job
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") || "recoverable";

    const manager = getKiroBulkImportManager();
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
