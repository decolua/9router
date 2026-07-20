import { NextResponse } from "next/server";
import { getAutoClawBulkImportManager } from "@/lib/oauth/services/autoclawBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const manager = getAutoClawBulkImportManager();
  const job = manager.cancelJob(params.jobId);

  if (!job) {
    return NextResponse.json({ error: "Bulk import job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}
