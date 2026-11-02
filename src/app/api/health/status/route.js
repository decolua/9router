import { NextResponse } from "next/server";
import { buildHealthStatus } from "@/lib/services/healthStatusService.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function GET() {
  try {
    const statusReport = await buildHealthStatus();
    const httpStatus = statusReport.status === "unhealthy" ? 503 : 200;
    return NextResponse.json(statusReport, {
      status: httpStatus,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: CORS_HEADERS,
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
