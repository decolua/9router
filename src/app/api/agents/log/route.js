import { NextResponse } from "next/server";
import { readLog } from "@/lib/agents/runner";
import { agentsErrorResponse } from "@/lib/agents/http";

export const dynamic = "force-dynamic";

// GET /api/agents/log?slot=N - tail log slot (mentah, maks 256KB)
export async function GET(request) {
  try {
    const slot = Number(request.nextUrl.searchParams.get("slot"));
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) {
      return NextResponse.json({ error: "slot 1-5" }, { status: 400 });
    }
    return NextResponse.json(readLog(slot));
  } catch (error) {
    return agentsErrorResponse(error, "log");
  }
}
