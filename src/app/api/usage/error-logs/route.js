import { NextResponse } from "next/server";
import { getErrorLogs, getErrorLogById } from "@/lib/db/repos/errorLogsRepo.js";

/**
 * GET /api/usage/error-logs
 * Query: page, pageSize, provider, model, connectionId, comboName, statusCode, startDate, endDate
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (id) {
      const detail = await getErrorLogById(id);
      if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(detail);
    }

    const pageRaw = parseInt(searchParams.get("page"));
    const page = Number.isNaN(pageRaw) ? 1 : pageRaw;
    const pageSizeRaw = parseInt(searchParams.get("pageSize"));
    const pageSize = Number.isNaN(pageSizeRaw) ? 20 : pageSizeRaw;

    const filter = { page, pageSize };
    const scalarKeys = ["provider", "model", "connectionId", "comboName", "statusCode", "startDate", "endDate"];
    for (const key of scalarKeys) {
      const value = searchParams.get(key);
      if (value) filter[key] = value;
    }

    if (page < 1) {
      return NextResponse.json({ error: "Page must be >= 1" }, { status: 400 });
    }
    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ error: "PageSize must be between 1 and 100" }, { status: 400 });
    }

    const result = await getErrorLogs(filter);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[API] Failed to get error logs:", error);
    return NextResponse.json({ error: "Failed to fetch error logs" }, { status: 500 });
  }
}
