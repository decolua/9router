import { NextResponse } from "next/server";
import { getProviderHealth } from "@/lib/providers/health.js";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");

  try {
    const health = await getProviderHealth(provider);
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      providers: health
    });
  } catch (error) {
    return NextResponse.json({
      status: "degraded",
      timestamp: new Date().toISOString(),
      error: error.message
    }, { status: 503 });
  }
}