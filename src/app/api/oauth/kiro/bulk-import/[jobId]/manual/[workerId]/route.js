import { NextResponse } from "next/server";
import { getKiroBulkImportManager } from "@/lib/oauth/services/kiroBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const manager = getKiroBulkImportManager();
  const result = await manager.openManualSession(params.jobId, params.workerId);

  if (!result) {
    return NextResponse.json({ error: "Bulk import job not found" }, { status: 404 });
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error || "Manual session not found for this worker",
        job: result.job,
      },
      { status: result.status || 404 }
    );
  }

  return NextResponse.json({
    success: true,
    job: result.job,
    account: result.account,
  });
}
