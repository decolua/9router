import { NextResponse } from "next/server";
import { getAutoClawBulkImportManager } from "@/lib/oauth/services/autoclawBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId, workerId } = await params;
  const manager = getAutoClawBulkImportManager();
  const result = await manager.openManualSession(jobId, workerId);

  if (!result) {
    return NextResponse.json(
      { error: "Job not found" },
      { status: 404 },
    );
  }

  if (result.ok === false) {
    return NextResponse.json(
      { error: result.error || "Manual session not available" },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true, job: result.job });
}
