import { NextResponse } from "next/server";
import { getApiKeyById, getDetailedApiKeyUsage } from "@/lib/localDb";
import { buildApiKeyUsageSummaryResponse } from "@/sse/services/auth";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const detail = await getDetailedApiKeyUsage(key, {
      periodType: searchParams.get("periodType") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      endpoint: searchParams.get("endpoint") || undefined,
      status: searchParams.get("status") || undefined,
      limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : 100,
    });

    return NextResponse.json(
      buildApiKeyUsageSummaryResponse(key, detail.limitState, detail.history),
    );
  } catch (error) {
    console.error("Error fetching API key usage:", error);
    return NextResponse.json(
      { error: "Failed to fetch API key usage" },
      { status: 500 },
    );
  }
}
