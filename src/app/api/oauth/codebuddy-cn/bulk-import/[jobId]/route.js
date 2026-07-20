import { NextResponse } from "next/server";
import { buildLookupResponse, getCodeBuddyCnPhoneImportManager } from "@/lib/oauth/services/codebuddyCnPhoneImportManager";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { jobId } = await params;
  const manager = getCodeBuddyCnPhoneImportManager();
  const job = await manager.getJobWithPreview(jobId);

  if (!job) {
    return NextResponse.json({
      success: false,
      ...buildLookupResponse(null, { stale: true }),
      error: "CodeBuddy CN phone import job not found",
    }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    ...buildLookupResponse(job),
  });
}
