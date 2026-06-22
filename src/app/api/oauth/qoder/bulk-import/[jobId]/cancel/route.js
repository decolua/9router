import { NextResponse } from "next/server";
import { getQoderBulkImportManager } from "@/lib/oauth/services/qoderBulkImportManager";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/qoder/bulk-import/[jobId]/cancel
 * Cancel a running bulk import job
 */
export async function POST(request, { params }) {
  try {
    const { jobId } = params;
    
    if (!jobId) {
      return NextResponse.json(
        { error: "Job ID is required" },
        { status: 400 }
      );
    }

    const manager = getQoderBulkImportManager();
    const result = await manager.cancelJob(jobId);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Failed to cancel job" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Job cancellation requested",
      job: result.job,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to cancel job" },
      { status: 500 }
    );
  }
}
