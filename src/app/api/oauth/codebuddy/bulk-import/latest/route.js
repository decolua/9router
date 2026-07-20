import { NextResponse } from "next/server";
import { buildLookupResponse, getCodeBuddyBulkImportManager } from "@/lib/oauth/services/codebuddyBulkImportManager";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const manager = getCodeBuddyBulkImportManager();
  const searchParams = new URL(request.url).searchParams;
  const scope = searchParams.get("scope");
  const includeRecentTerminal = scope === "recent" || scope === "all";
  const job = await manager.getLatestJobWithPreview({ includeRecentTerminal });

  if (!job) {
    return NextResponse.json({
      success: false,
      ...buildLookupResponse(null),
      error: "Bulk import job not found",
    }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    ...buildLookupResponse(job),
  });
}
