import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { resetRoundrobinCursors } from "open-sse/services/modelFallback.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ modelFallbacks: settings.modelFallbacks || {} }, { headers: NO_STORE });
}

// PATCH body: { modelFallbacks: { [primary]: { fallback, enabled, updatedAt } } }
export async function PATCH(request) {
  const body = await request.json();
  if (!body || typeof body.modelFallbacks !== "object" || body.modelFallbacks === null) {
    return NextResponse.json({ error: "modelFallbacks object required" }, { status: 400 });
  }
  const settings = await updateSettings({ modelFallbacks: body.modelFallbacks });
  // Invalidate roundrobin cursors — they reference primary keys whose list
  // order may have changed, so the next resolve would start from a stale index.
  resetRoundrobinCursors();
  return NextResponse.json({ modelFallbacks: settings.modelFallbacks }, { headers: NO_STORE });
}
