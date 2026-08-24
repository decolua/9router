import { NextResponse } from "next/server";
import { getUsageLogs } from "@/lib/usageDb";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getUsageLogs({
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
      apiKey: searchParams.get("apiKey"),
      provider: searchParams.get("provider"),
      status: searchParams.get("logType") || searchParams.get("status"),
      sortBy: searchParams.get("sortBy"),
      sortOrder: searchParams.get("sortOrder"),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[API ERROR] /api/usage/logs failed:", error);
    console.error("[API ERROR] Stack:", error?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
