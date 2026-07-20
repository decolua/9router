import { NextResponse } from "next/server";
import { getAntigravityBulkImportManager, buildLookupResponse } from "@/lib/oauth/services/antigravityBulkImportManager";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const manager = getAntigravityBulkImportManager();
  const searchParams = new URL(request.url).searchParams;
  const scope = searchParams.get("scope");
  const includeRecentTerminal = scope === "recent" || scope === "all";
  const job = await manager.getLatestJobWithPreview({ includeRecentTerminal });

  if (!job) {
    return NextResponse.json({
      success: true,
      ...buildLookupResponse(null),
    });
  }

  return NextResponse.json({
    success: true,
    ...buildLookupResponse(job),
  });
}
