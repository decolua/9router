import { NextResponse } from "next/server";
import { getConfig, getState, sanitizeConfig, saveConfig } from "@/lib/agents/runner";
import { agentsErrorResponse } from "@/lib/agents/http";

export const dynamic = "force-dynamic";

// GET /api/agents - config + state slot (status = exit code + log, tanpa parse output)
export async function GET() {
  try {
    return NextResponse.json({ config: getConfig(), state: getState() });
  } catch (error) {
    console.log("agents GET error:", error);
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}

// POST /api/agents - simpan config (validasi dulu, launch terpisah)
export async function POST(request) {
  try {
    const body = await request.json();
    const cfg = sanitizeConfig(body.config ?? body);
    saveConfig(cfg);
    return NextResponse.json({ config: cfg });
  } catch (error) {
    return agentsErrorResponse(error, "config");
  }
}
