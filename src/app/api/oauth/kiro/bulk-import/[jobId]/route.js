import { NextResponse } from "next/server";
import { buildLookupResponse, getKiroBulkImportManager } from "@/lib/oauth/services/kiroBulkImportManager";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const manager = getKiroBulkImportManager();
  const job = await manager.getJobWithPreview(params.jobId);

  if (!job) {
    return NextResponse.json({
      success: false,
      ...buildLookupResponse(null, { stale: true }),
      error: "Bulk import job not found",
    }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    ...buildLookupResponse(job),
  });
}
