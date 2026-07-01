import { NextResponse } from "next/server";
import { getQoderBulkImportManager } from "@/lib/oauth/services/qoderBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId, workerId } = await params;
  const manager = getQoderBulkImportManager();
  const result = await manager.openManualSession(jobId, workerId);

  if (!result) {
    return NextResponse.json(
      { error: "Bulk import job not found" },
      { status: 404 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error || "Manual session not found for this worker",
        job: result.job,
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    job: result.job,
    account: result.account,
  });
}
