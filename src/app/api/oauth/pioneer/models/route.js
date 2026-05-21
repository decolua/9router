import { NextResponse } from "next/server";
import { PioneerService } from "@/lib/oauth/services/pioneer";
import { getProviderConnectionById } from "@/models";

/**
 * GET /api/oauth/pioneer/models?connectionId=...
 *
 * Returns the live list of models this Pioneer connection can call right now:
 *   - Base models with supports_on_demand_inference=true
 *   - User's completed fine-tuning jobs (callable by job_id)
 *
 * Source of truth for the dashboard's per-connection model picker.
 */
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }

    const conn = await getProviderConnectionById(connectionId);
    if (!conn || conn.provider !== "pioneer") {
      return NextResponse.json({ error: "Pioneer connection not found" }, { status: 404 });
    }
    if (!conn.apiKey) {
      return NextResponse.json({ error: "Connection has no API key stored" }, { status: 400 });
    }

    const pioneer = new PioneerService();
    const { onDemand, finetuned } = await pioneer.collectUsableModels(conn.apiKey);
    return NextResponse.json({
      success: true,
      connectionId,
      onDemand,
      finetuned,
      total: onDemand.length + finetuned.length,
    });
  } catch (error) {
    console.log("Pioneer models list error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list Pioneer models" },
      { status: 500 }
    );
  }
}
