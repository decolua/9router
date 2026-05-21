import { NextResponse } from "next/server";
import { PioneerService } from "@/lib/oauth/services/pioneer";
import { getProviderConnectionById } from "@/models";

/**
 * GET    /api/oauth/pioneer/training-jobs/[jobId]?connectionId=...
 *   Fetch detail for one training job.
 *
 * DELETE /api/oauth/pioneer/training-jobs/[jobId]?connectionId=...
 *   Stop / cancel a running job (Pioneer maps to POST /stop).
 */
export const dynamic = "force-dynamic";

async function gate(connectionId) {
  if (!connectionId) return { error: "connectionId is required", status: 400 };
  const conn = await getProviderConnectionById(connectionId);
  if (!conn || conn.provider !== "pioneer") {
    return { error: "Pioneer connection not found", status: 404 };
  }
  if (!conn.apiKey) return { error: "Connection has no API key", status: 400 };
  return { conn };
}

export async function GET(request, { params }) {
  try {
    const { jobId } = await params;
    const { searchParams } = new URL(request.url);
    const g = await gate(searchParams.get("connectionId"));
    if (g.error) return NextResponse.json({ error: g.error }, { status: g.status });

    const pioneer = new PioneerService();
    const job = await pioneer.getTrainingJob(g.conn.apiKey, jobId);
    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.log("Pioneer get training-job error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch training job" },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    const { jobId } = await params;
    const { searchParams } = new URL(request.url);
    const g = await gate(searchParams.get("connectionId"));
    if (g.error) return NextResponse.json({ error: g.error }, { status: g.status });

    const pioneer = new PioneerService();
    const result = await pioneer.stopTrainingJob(g.conn.apiKey, jobId);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.log("Pioneer stop training-job error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to stop training job" },
      { status: 500 }
    );
  }
}
