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

    const db = await getAdapter();
    const row = db.get(
      `SELECT quotaType, quotaLimit, quotaResetHours, creditBalance FROM apiKeys WHERE key = ?`,
      [key]
    );

    if (!row || !row.quotaType || row.quotaType === "none") {
      return NextResponse.json({ quotaType: "none" }, { headers: CORS_HEADERS });
    }

    if (row.quotaType === "hourly") {
      if (row.quotaLimit == null) {
        return NextResponse.json({ quotaType: "none" }, { headers: CORS_HEADERS });
      }
      const resetHours = row.quotaResetHours || 1;
      const periodMs = resetHours * 3600000;
      const now = Date.now();
      const periodStart = new Date(Math.floor(now / periodMs) * periodMs).toISOString();
      const resetsAt = new Date(Math.floor(now / periodMs) * periodMs + periodMs).toISOString();

      const result = db.get(
        `SELECT COALESCE(SUM(cost), 0) as totalCost FROM usageHistory WHERE apiKey = ? AND timestamp >= ?`,
        [key, periodStart]
      );
      const used = result?.totalCost || 0;
      const limit = row.quotaLimit;
      const remaining = Math.max(0, limit - used);

      return NextResponse.json(
        { quotaType: "hourly", used, limit, remaining, resetsAt, resetHours },
        { headers: CORS_HEADERS }
      );
    }

    if (row.quotaType === "credit") {
      if (row.creditBalance == null) {
        return NextResponse.json({ quotaType: "none" }, { headers: CORS_HEADERS });
      }
      const result = db.get(
        `SELECT COALESCE(SUM(cost), 0) as totalCost FROM usageHistory WHERE apiKey = ?`,
        [key]
      );
      const used = result?.totalCost || 0;
      const limit = row.creditBalance;
      const remaining = Math.max(0, limit - used);

      return NextResponse.json(
        { quotaType: "credit", used, limit, remaining },
        { headers: CORS_HEADERS }
      );
    }

    return NextResponse.json({ quotaType: "none" }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[API] public/usage/quota GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
