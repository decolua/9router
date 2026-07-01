import { NextResponse } from "next/server";
import { getAutoClawBulkImportManager } from "@/lib/oauth/services/autoclawBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getAutoClawBulkImportManager();
  const job = manager.cancelJob(jobId);
  return NextResponse.json({ success: true, job });
}
