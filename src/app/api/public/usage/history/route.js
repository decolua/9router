import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/db/index.js";
import { getAdapter } from "@/lib/db/driver.js";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const key = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!key) {
      return NextResponse.json({ error: "Missing API key" }, { status: 401, headers: CORS_HEADERS });
    }

    const valid = await validateApiKey(key);
    if (!valid) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS_HEADERS });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit")) || 20, 1), 50);

    const db = await getAdapter();
    const rows = db.all(
      `SELECT timestamp, provider, model, endpoint, promptTokens, completionTokens, cost, status
       FROM usageHistory WHERE apiKey = ? ORDER BY timestamp DESC LIMIT ?`,
      [key, limit]
    );

    return NextResponse.json({ data: rows }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[API] public/usage/history GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
