import { NextResponse } from "next/server";
import { getApiKeyByValue, getSettings } from "@/lib/localDb";
import { getUsageLogs } from "@/lib/usageDb";
import { extractModelMarketApiKey, sanitizeModelMarketLog } from "@/lib/auth/modelMarket";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const apiKey = extractModelMarketApiKey(request);
  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }

  const keyRecord = await getApiKeyByValue(apiKey);
  if (!keyRecord?.isActive) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const result = await getUsageLogs({
      page: searchParams.get("page"),
      pageSize: Math.min(50, Math.max(1, Number(searchParams.get("pageSize")) || 20)),
      apiKey: keyRecord.id,
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
      provider: searchParams.get("provider"),
      endpoint: searchParams.get("endpoint"),
      selectedModel: searchParams.get("selectedModel"),
      actualModel: searchParams.get("actualModel"),
      status: searchParams.get("logType") || searchParams.get("status"),
    });
    const settings = await getSettings();
    return NextResponse.json({
      logs: result.logs.map(sanitizeModelMarketLog),
      filterOptions: result.filterOptions,
      pagination: result.pagination,
      columns: Array.isArray(settings.modelMarketLogColumns) ? settings.modelMarketLogColumns : undefined,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Model Market] Failed to fetch scoped usage logs:", error);
    return NextResponse.json({ error: "Failed to fetch usage logs" }, { status: 500 });
  }
}
