import { NextResponse } from "next/server";
import { applySelectiveTransfer } from "@/lib/localDb";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { resetComboRotation } from "open-sse/services/combo.js";

export async function POST(request) {
  try {
    const { password, payload, resolutions } = await request.json();
    const providerPayload = Array.isArray(payload?.providerConnections) ? payload.providerConnections : [];
    // A metadata-only combo transfer does not contain credentials. Provider
    // imports retain the existing dashboard password protection.
    if (providerPayload.length > 0 && !(await verifyDashboardPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const result = await applySelectiveTransfer(payload, resolutions || {});
    resetComboRotation();
    return NextResponse.json(result);
  } catch (error) {
    console.log("[Transfer] Import failed:", error.message);
    return NextResponse.json({ error: error.message || "Failed to import selection" }, { status: 400 });
  }
}
