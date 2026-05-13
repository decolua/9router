import { NextResponse } from "next/server";
import { validateApiKey, getCombos } from "@/lib/db/index.js";

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

    const combos = await getCombos();
    const models = combos.map((c) => ({
      name: c.name,
      modelCount: Array.isArray(c.models) ? c.models.length : 0,
      kind: c.kind || null,
    }));

    return NextResponse.json({ models }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[API] public/models GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
