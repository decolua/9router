import { NextResponse } from "next/server";
import { getQoderBulkImportManager } from "@/lib/oauth/services/qoderBulkImportManager";

export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/qoder/bulk-import/[jobId]
 * Get status of a specific bulk import job
 */
export async function GET(request, { params }) {
  try {
    const { jobId } = params;
    
    if (!jobId) {
      return NextResponse.json(
        { error: "Job ID is required" },
        { status: 400 }
      );
    }

    const manager = getQoderBulkImportManager();
    const job = await manager.getJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to get job status" },
      { status: 500 }
    );
  }
}
