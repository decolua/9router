import { audit, auditActor } from "@/lib/observability/audit";
import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/localDb";

// Reset dashboard password to default by clearing the stored hash.
// Local-only (enforced by dashboardGuard). Never returns the default literal.
export async function POST(request) {
  try {
    const identity = await auditActor(request);
    await updateSettings({ password: null });
    await audit(request, "password.change", { identity });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
