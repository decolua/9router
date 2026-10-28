import { NextResponse } from "next/server";
import { getApiKeyById, getApiKeyPeriodSpend, getApiKeyUsageReport } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

const ALLOWED_DAYS = [7, 30, 90];

// GET /api/keys/[id]/usage?days=30 - Usage report + current budget spend for one key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

    const requested = Number(new URL(request.url).searchParams.get("days"));
    const days = ALLOWED_DAYS.includes(requested) ? requested : 30;
    const [report, spend] = await Promise.all([getApiKeyUsageReport(key.key, days), getApiKeyPeriodSpend(key.key)]);
    return NextResponse.json({ ...report, spend });
  } catch (error) {
    console.log("Error fetching key usage:", error);
    return NextResponse.json({ error: "Failed to fetch key usage" }, { status: 500 });
  }
}
