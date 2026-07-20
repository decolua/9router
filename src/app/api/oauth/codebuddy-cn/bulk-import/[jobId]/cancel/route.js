import { NextResponse } from "next/server";
import { getCodeBuddyCnPhoneImportManager } from "@/lib/oauth/services/codebuddyCnPhoneImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getCodeBuddyCnPhoneImportManager();
  const job = manager.cancelJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "CodeBuddy CN phone import job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}
