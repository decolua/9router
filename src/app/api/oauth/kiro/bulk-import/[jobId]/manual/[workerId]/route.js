import { NextResponse } from "next/server";
import { getKiroBulkImportManager } from "@/lib/oauth/services/kiroBulkImportManager";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/kiro/bulk-import/[jobId]/manual/[workerId]
 * Open a manual browser session for an account that needs 2FA/CAPTCHA assistance
 */
export async function POST(request, { params }) {
  try {
    const { jobId, workerId } = params;
    
    if (!jobId || !workerId) {
      return NextResponse.json(
        { error: "Job ID and Worker ID are required" },
        { status: 400 }
      );
    }

    const manager = getKiroBulkImportManager();
    const result = await manager.openManualSession(jobId, workerId);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Failed to open manual session" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Manual session opened",
      account: result.account,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to open manual session" },
      { status: 500 }
    );
  }
}
