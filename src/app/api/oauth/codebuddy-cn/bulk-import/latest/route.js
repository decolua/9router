import { NextResponse } from "next/server";
import { buildLookupResponse, getCodeBuddyCnPhoneImportManager } from "@/lib/oauth/services/codebuddyCnPhoneImportManager";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const manager = getCodeBuddyCnPhoneImportManager();
  const searchParams = new URL(request.url).searchParams;
  const scope = searchParams.get("scope");
  const includeRecentTerminal = scope === "recent" || scope === "all";
  const job = await manager.getLatestJobWithPreview({ includeRecentTerminal });

  if (!job) {
    return NextResponse.json({
      success: false,
      ...buildLookupResponse(null),
      error: "CodeBuddy CN phone import job not found",
    }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    ...buildLookupResponse(job),
  });
}
