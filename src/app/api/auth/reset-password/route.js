import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/localDb";
import { hasValidCliToken, isAuthenticated } from "@/dashboardGuard";

async function requireAuth(request) {
  if (await hasValidCliToken(request) || await isAuthenticated(request)) return true;
  return false;
}

// Reset dashboard password to default by clearing the stored hash.
// Local-only (enforced by dashboardGuard). Never returns the default literal.
export async function POST(request) {
  if (!(await requireAuth(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await updateSettings({ password: null });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
